export type Role = "adult" | "teen" | "child";

export interface Member {
  id: string;
  name: string;
  role: Role;
  has_car: boolean;
  capacity_minutes: number;
  dislikes: string[];
  remind_before_min: number;
  /** Тема оформления; null — не выбирал(а), показываем «Лаванду» */
  theme: string | null;
  /** Проверка просьбы перед отправкой; null — «если что-то неясно» */
  confirm_mode: ConfirmMode | null;
  /** Есть устройство с push — иначе поручения до человека сами не дойдут */
  notifications: boolean;
}

export type ConfirmMode = "auto" | "always" | "never";

/** Разобранная фраза — ещё не задача (шторка «Проверьте просьбу»). */
export interface Draft {
  title: string;
  due_at: string | null;
  recurrence: Recurrence;
  priority: "low" | "normal" | "high";
  items: string[];
  requires_car: boolean;
  note: string | null;
  assignee_id: string | null;
  rationale: string | null;
  clarifying_question: string | null;
  unclear: boolean;
}

export interface NewTask {
  title: string;
  due_at: string | null;
  assignee_id?: string | null;
  recurrence?: Recurrence;
  priority?: "low" | "normal" | "high";
  items?: string[];
  requires_car?: boolean;
  source?: "text" | "voice" | "manual";
  source_text?: string | null;
  note?: string | null;
  defer_notify?: boolean;
}

export interface TaskFile {
  id: string;
  name: string;
  content_type: string;
  size: number;
  uploaded_by_id: string;
  /** Подписанная ссылка — открывается без входа, перебрать нельзя */
  url: string;
}

export interface TaskItem {
  text: string;
  done: boolean;
}

export interface Session {
  token: string;
  member: Member;
  family_id: string;
}

/** Начало входа: «pin» — у номера есть PIN-код; «call» — позвонить на call_phone. */
export interface PhoneCheck {
  method: "call" | "pin";
  phone_masked: string;
  check_id: string | null;
  call_phone: string | null;
  call_phone_pretty: string | null;
  expires_in_s: number | null;
}

export interface PhoneCheckStatus {
  status: "pending" | "confirmed" | "expired" | "used";
  token: string | null;
}

export interface Account {
  phone_masked: string;
  has_pin: boolean;
  member: Member | null;
  family_id: string | null;
}

export interface ActInfo {
  task: Task;
  member_name: string;
  author_name: string;
  assignee_name: string | null;
  can_accept: boolean;
  can_decline: boolean;
  can_done: boolean;
  can_remember: boolean;
}

export interface Family {
  id: string;
  name: string;
  invite_code: string;
  ref_code: string;
  members: Member[];
}

export type Recurrence = "none" | "daily" | "weekdays" | "weekly" | "monthly";

export interface Task {
  id: string;
  title: string;
  source: "text" | "voice" | "manual";
  beneficiary: string | null;
  due_at: string | null;
  duration_minutes: number;
  priority: "low" | "normal" | "high";
  recurrence: Recurrence;
  requires_car: boolean;
  location: string | null;
  clarifying_question: string | null;
  status: "new" | "accepted" | "done";
  assignee_id: string | null;
  created_by_id: string;
  rationale: string | null;
  decline_reason: string | null;
  items: TaskItem[];
  reminded_at: string | null;
  remembered_at: string | null;
  /** «Не выполнено»: что не так, по словам автора */
  feedback: string | null;
  feedback_at: string | null;
  /** Заметка: кабинет, адрес, что взять — подробности, которые не влезают в название */
  note: string | null;
  files: TaskFile[];
  created_at: string;
  accepted_at: string | null;
  completed_at: string | null;
}

export type ClientEvent =
  | "app_open"
  | "screen_view"
  | "invite_shared"
  | "pwa_opened"
  | "install_prompt_shown"
  | "install_accepted"
  | "push_prompt_shown"
  | "push_permission_granted"
  | "push_permission_denied";

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
  // FormData (файлы) — браузер сам поставит multipart с границей
  if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  const token = tokenStore.get();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, { ...init, headers });
  } catch {
    // «Load failed» / «Failed to fetch» — запрос не дошёл до сервера
    throw new ApiError(0, "Нет связи с сервером. Проверьте интернет и попробуйте ещё раз");
  }
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
  startPhoneCheck: (phone: string, call = false, consent = false) =>
    post<PhoneCheck>("/auth/phone/start", { phone, call, consent }),
  pinLogin: (phone: string, pin: string) => post<{ token: string }>("/auth/pin/login", { phone, pin }),
  setPin: (pin: string) => post<void>("/auth/pin", { pin }),
  phoneCheckStatus: (checkId: string) => request<PhoneCheckStatus>(`/auth/phone/status/${checkId}`),
  account: () => request<Account>("/account"),
  logout: () => post<void>("/auth/logout").catch(() => undefined),

  createFamily: (member_name: string, ref: string | null = null) =>
    post<Session>("/families", { member_name, ref }),
  referralInfo: (code: string) => request<{ from_name: string }>(`/referrals/${code}`),
  inviteInfo: (code: string) =>
    request<{ family_name: string; members: string[] }>(`/invites/${code}`),
  join: (code: string, member_name: string, role: Role) =>
    post<Session>(`/invites/${code}/join`, { member_name, role }),
  me: () => request<Session>("/me"),
  updateMe: (changes: Partial<Pick<Member, "name" | "remind_before_min" | "theme" | "confirm_mode">>) =>
    patch<Member>("/me", changes),
  family: () => request<Family>("/family"),

  tasks: (doneDays = 1) => request<Task[]>(`/tasks?include_done_days=${doneDays}`),
  createTask: (task: NewTask) => post<Task>("/tasks", task),
  parseTask: (message: string, source: "text" | "voice") => post<Draft>("/tasks/parse", { message, source }),
  notifyTask: (id: string) => post<void>(`/tasks/${id}/notify`),
  dispatch: (message: string, source: "text" | "voice") =>
    post<Task>("/tasks/dispatch", { message, source }),
  updateTask: (id: string, changes: Partial<Pick<Task, "title" | "due_at" | "assignee_id" | "recurrence" | "note">>) =>
    patch<Task>(`/tasks/${id}`, changes),
  setItems: (id: string, items: TaskItem[]) => request<Task>(`/tasks/${id}/items`, { method: "PUT", body: JSON.stringify({ items }) }),
  accept: (id: string) => post<Task>(`/tasks/${id}/accept`),
  decline: (id: string, reason: string | null) => post<Task>(`/tasks/${id}/decline`, { reason }),
  done: (id: string) => post<Task>(`/tasks/${id}/done`),
  reopen: (id: string) => post<Task>(`/tasks/${id}/reopen`),
  reject: (id: string, comment: string | null) => post<Task>(`/tasks/${id}/reject`, { comment }),
  attach: (id: string, file: File) => {
    const form = new FormData();
    form.append("upload", file, file.name);
    return request<Task>(`/tasks/${id}/files`, { method: "POST", body: form });
  },
  feedback: (audio: Blob | null, text: string | null, device: string) => {
    const form = new FormData();
    if (audio) {
      const ext = audio.type.includes("mp4") ? "m4a" : audio.type.includes("ogg") ? "ogg" : "webm";
      form.append("audio", audio, `feedback.${ext}`);
    }
    if (text) form.append("text", text);
    form.append("device", device);
    return request<{ status: string }>("/support/feedback", { method: "POST", body: form });
  },
  detach: (id: string, fileId: string) => request<Task>(`/tasks/${id}/files/${fileId}`, { method: "DELETE" }),
  remove: (id: string) => request<void>(`/tasks/${id}`, { method: "DELETE" }),

  pushStatus: () => request<{ enabled: boolean; public_key: string | null; devices: number }>("/push/status"),
  pushSubscribe: (endpoint: string, p256dh: string, auth: string) =>
    post<void>("/push/subscribe", { endpoint, keys: { p256dh, auth } }),
  actInfo: (token: string) => request<ActInfo>(`/act/${token}`),
  act: (token: string, action: "accept" | "decline" | "done" | "remember", reason: string | null = null) =>
    post<ActInfo>(`/act/${token}/${action}`, action === "decline" ? { reason } : undefined),

  track: (name: ClientEvent, props: Record<string, string> = {}) =>
    post<void>("/events", { name, props }).catch(() => undefined),
};
