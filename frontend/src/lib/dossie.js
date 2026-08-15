import api from "@/lib/api";
import { toast } from "sonner";

/**
 * generateDossie — helper reutilizável para gerar o Dossiê Clínico Premium.
 * AJUSTE 1: desacoplado do AttendanceDialog para reuso futuro em Timeline,
 * Prontuário e Histórico de Atendimentos sem refatoração.
 *
 * @param {string} sessionId - id da sessão de atendimento (att_...)
 * @param {object} opts - { open?: boolean } abre o PDF em nova aba (default true)
 * @returns {Promise<{file_id, url, absoluteUrl, sha256, content_sha256, size}>}
 */
export async function generateDossie(sessionId, opts = {}) {
  const { open = true } = opts;
  if (!sessionId) throw new Error("sessionId obrigatório");
  const { data } = await api.get(`/attendance/${sessionId}/dossie-pdf`);
  const backend = process.env.REACT_APP_BACKEND_URL || "";
  const absoluteUrl = data?.url
    ? (data.url.startsWith("http") ? data.url : `${backend}${data.url}`)
    : null;
  if (open && absoluteUrl) {
    window.open(absoluteUrl, "_blank", "noopener");
  }
  return { ...data, absoluteUrl };
}

/**
 * generateDossieWithToast — wrapper com feedback de UI (toast + estado busy).
 * @param {string} sessionId
 * @param {(busy:boolean)=>void} [setBusy]
 */
export async function generateDossieWithToast(sessionId, setBusy) {
  try {
    setBusy?.(true);
    const res = await generateDossie(sessionId, { open: true });
    toast.success("Dossiê Clínico Premium gerado");
    return res;
  } catch (e) {
    toast.error(
      e?.response?.status === 400
        ? "Dossiê disponível apenas para atendimento finalizado"
        : "Falha ao gerar o Dossiê"
    );
    throw e;
  } finally {
    setBusy?.(false);
  }
}
