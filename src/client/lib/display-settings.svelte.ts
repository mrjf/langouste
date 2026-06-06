const IPA_LAYER_STORAGE_KEY = "langouste.display.ipa-layer.v1";

class IpaLayerPreference {
  enabled = $state(true);

  load(): void {
    if (!canUseLocalStorage()) return;
    try {
      const stored = localStorage.getItem(IPA_LAYER_STORAGE_KEY);
      if (stored === "true") this.enabled = true;
      if (stored === "false") this.enabled = false;
    } catch {
      // Display settings are optional; restricted storage should not block boot.
    }
  }

  set(enabled: boolean): void {
    this.enabled = enabled;
    if (!canUseLocalStorage()) return;
    try {
      localStorage.setItem(IPA_LAYER_STORAGE_KEY, String(enabled));
    } catch {
      // Keep the in-memory setting even when persistence is unavailable.
    }
  }

  toggle(): void {
    this.set(!this.enabled);
  }
}

export const ipaLayerPreference = new IpaLayerPreference();

export function loadDisplaySettings(): void {
  ipaLayerPreference.load();
}

export function setIpaLayerEnabled(enabled: boolean): void {
  ipaLayerPreference.set(enabled);
}

export function toggleIpaLayer(): void {
  ipaLayerPreference.toggle();
}

function canUseLocalStorage(): boolean {
  try {
    return typeof localStorage !== "undefined";
  } catch {
    return false;
  }
}
