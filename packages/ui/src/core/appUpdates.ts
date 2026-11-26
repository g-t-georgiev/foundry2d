/**
 * Registers the app's service worker (written by the build, see
 * `@gs2d/workspace/vite/pwa.ts`) and offers a reload when a new
 * version has been downloaded. The new version only takes over when the
 * user agrees, so an open tab never switches versions mid-edit (roadmap
 * item 38).
 */
export function registerAppUpdates(options: {
  /** Off in development: the dev server has no service worker. */
  enabled: boolean;
  /** App name for the banner, e.g. "Pixel". */
  appName: string;
}): void {
  if (!options.enabled || !("serviceWorker" in navigator)) return;
  const container = navigator.serviceWorker;
  let reloading = false;
  container.addEventListener("controllerchange", () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });

  const offer = (worker: ServiceWorker) => {
    if (document.querySelector(".app-update")) return;
    const banner = document.createElement("div");
    banner.className = "app-update";
    banner.setAttribute("role", "status");
    const text = document.createElement("span");
    text.textContent = `A new version of the ${options.appName} is ready.`;
    const reload = document.createElement("button");
    reload.className = "btn btn-small btn-primary";
    reload.textContent = "Reload";
    reload.addEventListener("click", () => worker.postMessage("skip-waiting"));
    const later = document.createElement("button");
    later.className = "btn btn-small";
    later.textContent = "Later";
    later.addEventListener("click", () => banner.remove());
    banner.append(text, reload, later);
    document.body.append(banner);
  };

  void container.register("./sw.js").then((registration) => {
    // Only offer an update when a version is already running (not on the first install).
    if (registration.waiting && container.controller) offer(registration.waiting);
    registration.addEventListener("updatefound", () => {
      const worker = registration.installing;
      worker?.addEventListener("statechange", () => {
        if (worker.state === "installed" && container.controller) offer(worker);
      });
    });
    // Look for a new version when the user comes back to the tab.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") void registration.update();
    });
  });
}
