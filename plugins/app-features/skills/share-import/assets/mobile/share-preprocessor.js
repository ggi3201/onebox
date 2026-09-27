// Runs INSIDE the web page someone shares from Safari, before the share
// extension opens (expo-share-intent's `preprocessorInjectJS`). Whatever it puts
// on `metas` arrives in the app as `shareIntent.meta`.
//
// Why: some sites refuse automated fetches (one answered the importer with
// HTTP 402 and a "contact support" page). The copy of the page the READER is
// looking at is the one copy that is not blocked, so take what you need from it
// here and nothing has to be fetched at all.
//
// Takes two things:
//   metas['ld-json']   the first schema.org node of a WANTED type, as JSON
//   metas['page-text'] the article text as the reader saw it, capped
//
// Edit WANTED for your app (Recipe, Product, Event, Book, Place, ...).
// app.json needs this as ONE string: run scripts/inline-preprocessor.sh.
try {
  var WANTED = ['Recipe'];
  var isWanted = function (t) {
    var types = Array.isArray(t) ? t : [t];
    return types.some(function (x) { return WANTED.indexOf(String(x).replace(/^.*[/#]/, '')) >= 0; });
  };
  var find = function (node, depth) {
    if (!node || typeof node !== 'object' || depth > 4) return null;
    if (Array.isArray(node)) {
      for (var i = 0; i < node.length; i++) { var a = find(node[i], depth + 1); if (a) return a; }
      return null;
    }
    if (isWanted(node['@type'])) return node;
    if (node['@graph']) return find(node['@graph'], depth + 1);
    if (node.mainEntity) return find(node.mainEntity, depth + 1);
    return null;
  };
  var scripts = document.querySelectorAll('script[type="application/ld+json"]');
  for (var s = 0; s < scripts.length && !metas['ld-json']; s++) {
    try {
      var hit = find(JSON.parse(scripts[s].textContent), 0);
      if (hit) metas['ld-json'] = JSON.stringify(hit);
    } catch (e) { /* one broken block must not stop the rest */ }
  }
} catch (e) {}
try {
  var root = document.querySelector('article') || document.querySelector('main') || document.body;
  var text = root && root.innerText ? root.innerText : '';
  // 40k characters is well past a long article and well short of a heavy payload.
  if (text) metas['page-text'] = text.replace(/\n{3,}/g, '\n\n').slice(0, 40000);
} catch (e) {}
