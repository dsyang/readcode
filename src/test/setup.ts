import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import { mockTauriInvoke, resetMockState } from "./tauriMock";

// Mock Tauri's invoke globally
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) => mockTauriInvoke(cmd, args),
}));

// Mock Tauri dialog plugin
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

// Mock Tauri updater plugin
vi.mock("@tauri-apps/plugin-updater", () => ({
  check: vi.fn().mockResolvedValue(null),
}));

// Mock Tauri process plugin
vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: vi.fn(),
}));

// Mock localStorage
const localStorageMap = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => localStorageMap.get(key) ?? null,
  setItem: (key: string, value: string) => localStorageMap.set(key, value),
  removeItem: (key: string) => localStorageMap.delete(key),
  clear: () => localStorageMap.clear(),
});

afterEach(() => {
  cleanup();
  resetMockState();
  localStorageMap.clear();
});
