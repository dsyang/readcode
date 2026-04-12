import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { useState, useEffect } from "react";

export function useUpdater() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updateVersion, setUpdateVersion] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    check()
      .then((update) => {
        if (update?.available) {
          setUpdateAvailable(true);
          setUpdateVersion(update.version);
        }
      })
      .catch(() => {}); // silently ignore network errors on startup
  }, []);

  const installUpdate = async () => {
    const update = await check();
    if (!update?.available) return;
    setInstalling(true);
    await update.downloadAndInstall();
    await relaunch();
  };

  return { updateAvailable, updateVersion, installing, installUpdate };
}
