export type Role = "adult" | "teen" | "child";

export interface Member {
  id: string;
  name: string;
  role: Role;
  has_car: boolean;
  capacity_minutes: number;
  dislikes: string[];
}

export interface Session {
  token: string;
  member: Member;
  family_id: string;
}

export interface PhoneCheck {
  check_id: string;
  call_phone: string;
  call_phone_pretty: string;
  phone_masked: string;
  expires_in_s: number;
}

export interface PhoneCheckStatus {
  status: "pending" | "confirmed" | "expired" | "used";
  token: string | null;
}

export interface Account {
  phone_masked: string;
  member: Member | null;
  family_id: string | null;
}

export interface LabourShare {
  member_id: string;
  name: string;
  minutes: number;
  share: number;
  open_tasks: number;
  done_tasks: number;
}

export interface Family {
  id: string;
  name: string;
  invite_code: string;
  members: Member[];
  labour: LabourShare[];
}

export interface Task {
  id: string;
  title: string;
  source: "text" | "voice" | "manual";
  beneficiary: string | null;
  due_at: string | null;
  duration_minutes: number;
  priority: "low" | "normal" | "high";
  recurrence: "none" | "daily" | "weekly" | "monthly";
  requires_car: boolean;
  location: string | null;
  clarifying_question: string | null;
  status: "open" | "done";
  assignee_id: string | null;
  created_by_id: string;
  rationale: string | null;
  created_at: string;
  completed_at: string | null;
}

const TOKEN_KEY = "fd.token";

export const tokenStore = {
  get(): string | null {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(token: string | null) {
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* приватный режим — живём без сохранения сессии */
    }
  },
};

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("Content-Type", "application/json");
  const token = tokenStore.get();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const response = await fetch(`/api/v1${path}`, { ...init, headers });
  if (!response.ok) {
    let message = "Что-то пошло не так";
    try {
      const body = await response.json();
      if (typeof body.detail === "string") message = body.detail;
    } catch {
      /* тело без JSON */
    }
    throw new ApiError(response.status, message);
  }
  return response.status === 204 ? (undefined as T) : response.json();
}

const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
const patch = <T>(path: string, body: unknown) =>
  request<T>(path, { method: "PATCH", body: JSON.stringify(body) });

export const api = {
  startPhoneCheck: (phone: string) => post<PhoneCheck>("/auth/phone/start", { phone }),
  phoneCheckStatus: (checkId: string) => request<PhoneCheckStatus>(`/auth/phone/status/${checkId}`),
  account: () => request<Account>("/account"),
  logout: () => post<void>("/auth/logout").catch(() => undefined),

  createFamily: (family_name: string, member_name: string, has_car: boolean) =>
    post<Session>("/families", { family_name, member_name, has_car }),
  inviteInfo: (code: string) =>
    request<{ family_name: string; members: string[] }>(`/invites/${code}`),
  join: (code: string, member_name: string, role: Role, has_car: boolean) =>
    post<Session>(`/invites/${code}/join`, { member_name, role, has_car }),
  me: () => request<Session>("/me"),
  updateMe: (changes: Partial<Pick<Member, "name" | "has_car" | "dislikes">>) =>
    patch<Member>("/me", changes),
  family: () => request<Family>("/family"),

  tasks: () => request<Task[]>("/tasks"),
  dispatch: (message: string, source: "text" | "voice") =>
    post<Task>("/tasks/dispatch", { message, source }),
  updateTask: (id: string, changes: Partial<Pick<Task, "title" | "due_at" | "assignee_id">>) =>
    patch<Task>(`/tasks/${id}`, changes),
  done: (id: string) => post<Task>(`/tasks/${id}/done`),
  reopen: (id: string) => post<Task>(`/tasks/${id}/reopen`),
  reassign: (id: string) => post<Task>(`/tasks/${id}/reassign`),
  remove: (id: string) => request<void>(`/tasks/${id}`, { method: "DELETE" }),

  track: (name: "app_open" | "screen_view" | "invite_shared", props: Record<string, string> = {}) =>
    post<void>("/events", { name, props }).catch(() => undefined),
};
