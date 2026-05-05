import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { getVersion } from "@tauri-apps/api/app";
import { useState, useEffect } from "react";
import { diag, classifyUpdaterError } from "../diagnostics";

export function useUpdater() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updateVersion, setUpdateVersion] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    Promise.all([check(), getVersion().catch(() => null)])
      .then(([update, currentVersion]) => {
        const latestVersion = update?.version ?? null;
        const available = !!update?.available;
        diag.updaterCheck(available, currentVersion, latestVersion);
        if (available) {
          setUpdateAvailable(true);
          setUpdateVersion(update!.version);
        }
      })
      .catch((err) => {
        const kind = classifyUpdaterError(err);
        console.error("[updater] check failed", kind, err);
        diag.updaterError(kind);
      });
  }, []);

  const installUpdate = async () => {
    try {
      const update = await check();
      if (!update?.available) return;
      setInstalling(true);
      await update.downloadAndInstall();
      await relaunch();
    } catch (err) {
      const kind = classifyUpdaterError(err);
      console.error("[updater] install failed", kind, err);
      diag.updaterError(kind);
      setInstalling(false);
    }
  };

  return { updateAvailable, updateVersion, installing, installUpdate };
}
