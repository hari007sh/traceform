/**
 * Utility for downloading data exports from the API.
 *
 * Fetches the export endpoint with the current Bearer token and
 * triggers a browser file download using a temporary object URL.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

export type ExportFormat = "csv" | "json";

export interface ExportOptions {
  /** The API path, e.g. "/v1/export/sessions" */
  path: string;
  /** Desired filename for the download */
  filename: string;
  /** Export format: "csv" or "json" */
  format?: ExportFormat;
  /** ISO start date */
  start?: string;
  /** ISO end date */
  end?: string;
  /** Max rows */
  perPage?: number;
}

/**
 * Downloads an export file from the API.
 *
 * Uses fetch with the Bearer token from localStorage, converts the
 * response to a Blob, and triggers a download via a temporary anchor
 * element.
 *
 * @returns A promise that resolves when the download has been triggered,
 *          or rejects with an error message.
 */
export async function downloadExport(options: ExportOptions): Promise<void> {
  const { path, filename, format = "csv", start, end, perPage } = options;

  const token =
    typeof window !== "undefined" ? localStorage.getItem("token") : null;

  const params = new URLSearchParams();
  params.set("format", format);
  if (start) params.set("start", start);
  if (end) params.set("end", end);
  if (perPage) params.set("per_page", String(perPage));

  const url = `${API_URL}${path}?${params.toString()}`;

  const headers: Record<string, string> = {};
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(url, { headers });

  if (!res.ok) {
    let message = `Export failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error?.message) {
        message = body.error.message;
      }
    } catch {
      // ignore parse errors
    }
    throw new Error(message);
  }

  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);

  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();

  // Cleanup
  document.body.removeChild(anchor);
  URL.revokeObjectURL(objectUrl);
}
