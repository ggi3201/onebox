# Apple native icon workflow

These mechanics were exercised with Icon Composer on macOS in September 2026.
Inspect installed versions and current project configuration; use official Apple
and Expo documentation when capabilities or schema details differ.

## Tools

Icon Composer can already be bundled with Xcode. Locate Xcode with
`xcode-select -p`, then check the sibling application under Contents/Applications.
The standalone application may also be in /Applications.

Use the renderer INSIDE the Icon Composer application:

```sh
"/Applications/Xcode.app/Contents/Applications/Icon Composer.app/Contents/Executables/ictool" --help
```

On the tested installation, `xcrun ictool` instead invoked asset-compiler-style
argument handling and did not support the renderer's CLI. Use `xcrun actool`
for compilation, and the application-bundled `ictool` for preview exports.

A sandboxed renderer reported that even a known-good .icon could not be opened.
If both the new document and a known-good sample fail, investigate filesystem or
native-service access before rewriting the design. Request a narrowly scoped
sandbox escalation when necessary; do not hide errors or loop indefinitely.

Opening the visual editor may present Apple's license agreement. Do not accept
legal terms without the required user confirmation, and do not bypass an
agreement once encountered. Other independent SVG work can continue while the
user handles it. UI actions should use the available computer-use interface.

## Minimal flat-outline package

```text
Example.icon/
  icon.json
  Assets/
    mark.svg
```

A working flat-brass-on-charcoal example, with a transparent 1024-square SVG:

```json
{
  "fill": {"solid": "srgb:0.07451,0.07059,0.06667,1.00000"},
  "groups": [{
    "layers": [{"glass": false, "image-name": "mark.svg", "name": "Mark"}],
    "shadow": {"kind": "neutral", "opacity": 0},
    "translucency": {"enabled": false, "value": 0}
  }],
  "supported-platforms": {"squares": "shared"}
}
```

Adapt colors to the actual brand. In the editor, the equivalent foreground
control is Liquid Glass > Effects on the selected layer. Disabling translucency
alone does NOT disable the bevel/highlight. `glass: false` disables layer effects;
Apple may still apply a system surface treatment around the icon background.
Do not hardcode glass off for designs which intentionally use those effects.
Open and save the package in Icon Composer when practical to confirm it is editable.

## Native rendering

Use absolute document/output paths. Example commands (replace paths):

```sh
ICON_TOOL="/Applications/Xcode.app/Contents/Applications/Icon Composer.app/Contents/Executables/ictool"
"$ICON_TOOL" /absolute/Example.icon --export-image \
  --output-file /tmp/example-ios.png --platform iOS \
  --rendition Default --width 1024 --height 1024 --scale 1
"$ICON_TOOL" /absolute/Example.icon --export-image \
  --output-file /tmp/example-mac.png --platform macOS \
  --rendition Default --width 512 --height 512 --scale 1
"$ICON_TOOL" /absolute/Example.icon --export-image \
  --output-file /tmp/example-dark.png --platform iOS \
  --rendition Dark --width 60 --height 60 --scale 3
"$ICON_TOOL" /absolute/Example.icon --export-image \
  --output-file /tmp/example-tinted.png --platform iOS \
  --rendition TintedDark --width 60 --height 60 --scale 3 \
  --tint-color 0.25 --tint-strength 0.75
```

Inspect the exports. Successful rendering alone does not prove visual quality
or successful integration into the app.

## Expo integration and compilation

For Expo versions supporting Icon Composer, `expo.ios.icon` points to the .icon
folder and `expo.icon` can point to the opaque PNG fallback. Follow an existing
native project's conventions if Expo is not used. Do not create a Mac app target
merely because the same source supports a Mac icon.

In a pnpm Expo workspace, run Expo commands through the mobile package from the
repository root. Use the actual package name. Install locked dependencies if
needed; do not change the lockfile just to obtain tooling.

For a project using generated native directories, `expo prebuild --platform ios
--no-install` can verify integration without a release build. Inspect existing
native directories before running it: do not overwrite maintained native code
or use --clean casually. Prefer a temporary checkout for uncertain cases.

Verify that the generated Xcode project includes the .icon in Resources and
selects its basename with `ASSETCATALOG_COMPILER_APPICON_NAME` in Release as
well as Debug. Match deployment targets to the project when compiling:

```sh
mkdir -p /tmp/example-icon-compiled
xcrun actool /absolute/Example.icon \
  --compile /tmp/example-icon-compiled --platform iphoneos \
  --minimum-deployment-target 16.0 --app-icon Example \
  --output-partial-info-plist /tmp/example-icon-compiled/Info.plist \
  --target-device iphone --output-format human-readable-text
plutil -p /tmp/example-icon-compiled/Info.plist
```

Require successful compilation and correct primary-icon metadata; inspect the
produced assets and legacy renditions. This validates the icon compilation, not
a complete signed app archive or App Store acceptance.

The next native production build containing the change carries the icon. An OTA
JavaScript update cannot replace the installed or App Store icon. Distinguish
local changes, a PR, a merged change, and an actual submitted build in the handoff.

Official references:
- https://developer.apple.com/documentation/xcode/creating-your-app-icon-using-icon-composer
- https://developer.apple.com/design/human-interface-guidelines/app-icons
- https://docs.expo.dev/develop/user-interface/splash-screen-and-app-icon/
