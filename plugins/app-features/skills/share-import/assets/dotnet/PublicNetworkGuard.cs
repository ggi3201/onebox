using System.Net;
using System.Net.Sockets;

namespace MyApp.Api.Import;

/// <summary>
/// Keeps fetches of user-supplied URLs on the public internet (SSRF).
///
/// Without it, an import URL like <c>http://db:5432/</c>, <c>http://10.0.0.2/</c>
/// or the cloud metadata address makes your API read an internal service and
/// hand the result back. On a home box the "internal service" is your router,
/// your NAS and every other container.
///
/// Two layers, because a hostname check alone is not enough: DNS can answer
/// differently at connect time (rebinding), and a redirect can point anywhere.
/// - <see cref="IsPublicUrlAsync"/> screens a URL before you pass it to a
///   service you do not control (a scraper, a reader proxy).
/// - <see cref="CreateHandler"/> checks the actual IP of EVERY connection,
///   including each redirect hop. Use it for every HttpClient that fetches a
///   user-supplied URL:
///     builder.Services.AddHttpClient("public").ConfigurePrimaryHttpMessageHandler(PublicNetworkGuard.CreateHandler);
/// </summary>
public static class PublicNetworkGuard
{
    public static async Task<bool> IsPublicUrlAsync(string? url, CancellationToken ct = default)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri)) return false;
        if (uri.Scheme != Uri.UriSchemeHttps && uri.Scheme != Uri.UriSchemeHttp) return false;
        if (string.IsNullOrEmpty(uri.Host) || !uri.IsDefaultPort && uri.Port is not (80 or 443 or 8080 or 8443)) return false;
        if (IPAddress.TryParse(uri.Host, out var literal)) return IsPublic(literal);
        try
        {
            var addresses = await Dns.GetHostAddressesAsync(uri.Host, ct);
            return addresses.Length > 0 && addresses.All(IsPublic);
        }
        catch (SocketException)
        {
            return false;
        }
    }

    public static bool IsPublic(IPAddress address)
    {
        var ip = address.IsIPv4MappedToIPv6 ? address.MapToIPv4() : address;
        if (IPAddress.IsLoopback(ip)) return false;
        return ip.AddressFamily switch
        {
            AddressFamily.InterNetwork => IsPublicV4(ip.GetAddressBytes()),
            AddressFamily.InterNetworkV6 => IsPublicV6(ip),
            _ => false,
        };
    }

    /// <summary>A handler whose every socket goes to a public address. Redirects follow the same check.</summary>
    public static SocketsHttpHandler CreateHandler() => new()
    {
        AllowAutoRedirect = true,
        MaxAutomaticRedirections = 5,
        AutomaticDecompression = DecompressionMethods.All,
        ConnectTimeout = TimeSpan.FromSeconds(10),
        ConnectCallback = async (context, ct) =>
        {
            var addresses = (await Dns.GetHostAddressesAsync(context.DnsEndPoint.Host, ct)).Where(IsPublic).ToArray();
            if (addresses.Length == 0)
                throw new HttpRequestException($"Refusing to connect to non-public host {context.DnsEndPoint.Host}");

            Exception? last = null;
            foreach (var address in addresses)
            {
                var socket = new Socket(address.AddressFamily, SocketType.Stream, ProtocolType.Tcp) { NoDelay = true };
                try
                {
                    await socket.ConnectAsync(new IPEndPoint(address, context.DnsEndPoint.Port), ct);
                    return new NetworkStream(socket, ownsSocket: true);
                }
                catch (Exception e)
                {
                    socket.Dispose();
                    last = e;
                }
            }
            throw new HttpRequestException($"Could not connect to {context.DnsEndPoint.Host}", last);
        },
    };

    private static bool IsPublicV4(byte[] b) => !(
        b[0] == 0                                   // 0.0.0.0/8
        || b[0] == 10                               // 10.0.0.0/8
        || b[0] == 127                              // loopback
        || b[0] == 100 && b[1] is >= 64 and <= 127  // 100.64.0.0/10 CGNAT (Tailscale lives here)
        || b[0] == 169 && b[1] == 254               // link-local, incl. cloud metadata
        || b[0] == 172 && b[1] is >= 16 and <= 31   // 172.16.0.0/12 (Docker networks)
        || b[0] == 192 && b[1] == 0 && b[2] is 0 or 2 // 192.0.0.0/24, 192.0.2.0/24
        || b[0] == 192 && b[1] == 168               // 192.168.0.0/16
        || b[0] == 198 && b[1] is 18 or 19          // 198.18.0.0/15 benchmarking
        || b[0] == 198 && b[1] == 51 && b[2] == 100 // documentation
        || b[0] == 203 && b[1] == 0 && b[2] == 113  // documentation
        || b[0] >= 224);                            // multicast and reserved

    private static bool IsPublicV6(IPAddress ip)
    {
        if (ip.IsIPv6LinkLocal || ip.IsIPv6SiteLocal || ip.IsIPv6Multicast || ip.Equals(IPAddress.IPv6None)) return false;
        var b = ip.GetAddressBytes();
        if ((b[0] & 0xFE) == 0xFC) return false;                       // fc00::/7 unique local
        // 64:ff9b::/96 (NAT64) and 2002::/16 (6to4) can wrap an internal IPv4 address.
        if (b[0] == 0x00 && b[1] == 0x64 && b[2] == 0xff && b[3] == 0x9b) return IsPublicV4(b[12..16]);
        if (b[0] == 0x20 && b[1] == 0x02) return IsPublicV4(b[2..6]);
        return true;
    }
}
