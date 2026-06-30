(function () {
  try {
    var theme = localStorage.getItem("iph-theme");
    if (!theme) {
      theme =
        window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light";
    }
    var isLight = theme === "light";
    if (isLight) document.documentElement.classList.add("light");
    var c = isLight ? "#f0faf8" : "#021f20";
    // iOS 26+ Safari derives toolbar color from body background-color at initial render.
    // Inject a blocking <style> so the value is set before first paint, before the
    // external stylesheet loads.
    var s = document.createElement("style");
    s.textContent = "body{background-color:" + c + "}";
    document.head.appendChild(s);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", c);
  } catch (e) {}
})();
