/// <reference types="vite/client" />
import type { TrayAction, TrayState } from './types';

type ServerStatus = { connected: boolean; url?: string; name?: string };
type ServerResult<T> = ({ ok: true } & T) | { ok: false; error: string; status?: number };

type ApiRequest = { id: string; method: string; path: string; query: Record<string, string>; body: unknown };

declare global {
  interface Window {
    api: {
      load(): Promise<unknown>;
      save(data: unknown): Promise<void>;
      saveSync(data: unknown): boolean;
      updateTray(state: TrayState): void;
      setMenuIcons(icons: Record<string, string>): void;
      onApiRequest(cb: (req: ApiRequest) => void): () => void;
      apiRespond(id: string, status: number, body: unknown): void;
      apiHasKey(): Promise<boolean>;
      apiGenerateKey(): Promise<string>;
      apiStatus(): Promise<{ running: boolean; address: { address: string; port: number } | null }>;
      onApiError(cb: (message: string) => void): () => void;
      openFeedback(): void;
      shortcutStatus(): Promise<Record<string, boolean>>;
      suspendShortcuts(on: boolean): void;
      trailGet(day: string): Promise<{ app: string; start: string; end: string }[]>;
      trailClear(): Promise<void>;
      quickAction(action: TrayAction): void;
      quickHide(): void;
      quickOpenMain(): void;
      onQuickShow(cb: (mode: 'start') => void): () => void;
      serverStatus(): Promise<ServerStatus>;
      serverConnect(url: string, code: string): Promise<ServerResult<ServerStatus>>;
      serverDisconnect(): Promise<ServerStatus>;
      serverPairCode(name: string): Promise<ServerResult<{ code: string; expiresAt: string; link: string }>>;
      floatSetToken(token: string | null): Promise<void>;
      floatHasToken(): Promise<boolean>;
      floatGet(
        path: string,
        contact?: string,
      ): Promise<{ ok: true; status: number; data: unknown; pageCount: number } | { ok: false; status: number; error: string }>;
      personioSetCredentials(creds: { clientId: string; clientSecret: string } | null): Promise<void>;
      personioHasCredentials(): Promise<boolean>;
      personioGet(
        path: string,
        query?: Record<string, string | number>,
      ): Promise<{ ok: true; status: number; data: unknown[]; next: string | null } | { ok: false; status: number; error: string }>;
      onTrayAction(cb: (action: TrayAction) => void): () => void;
    };
  }
}
