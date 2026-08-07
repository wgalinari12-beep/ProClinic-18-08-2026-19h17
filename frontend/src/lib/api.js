import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

const api = axios.create({
  baseURL: API,
  withCredentials: true,
});

api.interceptors.request.use((cfg) => {
  const t = localStorage.getItem("pc_token");
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});

export default api;

/**
 * downloadFile — Baixa um arquivo (ex.: CSV) autenticado via axios (blob)
 * e dispara o download no navegador, preservando o header Authorization.
 */
export async function downloadFile(path, filename, params = {}) {
  const res = await api.get(path, { params, responseType: "blob" });
  const url = window.URL.createObjectURL(new Blob([res.data]));
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

export function formatApiErrorDetail(detail) {
  if (detail == null) return "Algo deu errado. Tente novamente.";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail))
    return detail
      .map((e) => (e && typeof e.msg === "string" ? e.msg : JSON.stringify(e)))
      .filter(Boolean)
      .join(" ");
  if (detail && typeof detail.msg === "string") return detail.msg;
  return String(detail);
}

/**
 * describeApiError — Converts any axios error into an actionable user-facing string.
 * Shows the real backend detail whenever possible; falls back to explicit
 * network/timeout/status descriptions otherwise.
 *
 *   catch (e) { toast.error(describeApiError(e, "Falha ao salvar")); }
 */
export function describeApiError(err, fallback = "Erro na operação") {
  // 1) Explicit backend detail (Pydantic 422, HTTPException, custom)
  const detail = err?.response?.data?.detail;
  if (detail) return formatApiErrorDetail(detail);
  const msgField = err?.response?.data?.message || err?.response?.data?.error;
  if (msgField) return String(msgField);

  // 2) Network / no response
  if (err?.code === "ECONNABORTED" || /timeout/i.test(err?.message || ""))
    return `${fallback}: timeout — o servidor não respondeu a tempo. Tente novamente.`;
  if (err?.code === "ERR_NETWORK" || err?.message === "Network Error")
    return `${fallback}: falha de rede. Verifique sua conexão.`;
  if (err?.name === "CanceledError" || err?.name === "AbortError")
    return `${fallback}: operação cancelada.`;

  // 3) HTTP status without payload detail
  const status = err?.response?.status;
  if (status === 401) return "Sessão expirada. Faça login novamente.";
  if (status === 403) return "Você não tem permissão para esta ação.";
  if (status === 404) return `${fallback}: registro não encontrado.`;
  if (status === 409) return `${fallback}: conflito de estado — o registro pode já ter sido finalizado.`;
  if (status === 422) return `${fallback}: dados inválidos (422). Alguns campos podem estar em formato incorreto.`;
  if (status === 429) return "Muitas requisições. Aguarde alguns segundos e tente novamente.";
  if (status === 502 || status === 503 || status === 504)
    return `${fallback}: gateway indisponível (${status}). O provedor de IA/backend pode estar sobrecarregado.`;
  if (status >= 500) return `${fallback}: erro interno (${status}). Nossa equipe será notificada.`;

  // 4) Last resort
  if (err?.message) return `${fallback}: ${err.message}`;
  return fallback;
}
