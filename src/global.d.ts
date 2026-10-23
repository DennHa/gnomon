/// <reference types="vite/client" />
import type { CompanyProfile, TrayAction, TrayState } from './types';

type ServerStatus = { connected: boolean; url?: string; name?: string };
type ServerResult<T> = ({ ok: true } & T) | { ok: false; error: string; status?: number };

/** A feedback conversation with the maker's server (see About.tsx). */
export type FeedbackThread = { id: string; status: 'new' | 'open' | 'done'; unread: number; messages: { author: 'user' | 'admin'; text: string; at: string }[] };

type ApiRequest = { id: string; method: string; path: string; query: Record<string, string>; body: unknown };

declare global {
  interface Window {
    api: {
      load(): Promise<unknown>;
      profile(): Promise<CompanyProfile | null>;
      setTheme(value: 'system' | 'light' | 'dark'): void;
      notify(title: string, body: string): void;
      appInfo(): Promise<{ version: string; electron: string; chrome: string; node: string; updateSource: string | null }>;
      checkUpdate(): Promise<
        | { ok: true; newer: boolean; latest: { version: string; date?: string; notes: string[]; download?: string; page?: string } }
        | { ok: false; error: string }
      >;
      openLink(url: string): void;
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
      /** Opens the server's Admin page in the browser, signed in. */
      serverAdminLink(): Promise<ServerResult<object>>;
      serverMyDevices(): Promise<ServerResult<{ devices: { id: string; name: string; client: string | null; lastSeenAt: string | null; current: boolean }[] }>>;
      feedbackAvailable(): Promise<boolean>;
      feedbackSend(msg: { text: string; sender?: string; withInfo: boolean }): Promise<ServerResult<object>>;
      feedbackThreads(): Promise<FeedbackThread[]>;
      feedbackReply(id: string, text: string): Promise<ServerResult<object>>;
      feedbackSeen(id: string, replies: number): Promise<void>;
      feedbackUnread(): Promise<number>;
      onFeedbackUnread(cb: (n: number) => void): () => void;
      serverSyncState(): Promise<import('./sync').SyncState | null>;
      serverSetSyncState(state: import('./sync').SyncState): Promise<boolean>;
      serverSyncPull(since: number): Promise<ServerResult<{ cursor: number; more: boolean; changes: import('./sync').Change[] }>>;
      serverSyncPush(changes: import('./sync').Change[]): Promise<ServerResult<{ applied: number; skipped: { kind: string; id: string; reason: string }[]; cursor: number }>>;
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
