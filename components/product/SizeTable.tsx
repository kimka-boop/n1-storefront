"use client";

/**
 * SizeTable — sizeChart 문자열("한국사이즈 단면(cm) — 95(XL): 어깨46·… / 100(2XL): …") 파싱.
 * 공백(G-50)은 렌더하지 않는다 — 상위에서 미제공 분기를 처리.
 * 순수 문자열 파싱만 수행 (쉘·프로세스 호출 없음).
 */
import styles from "@/app/product/[id]/product.module.css";

export interface ParsedSizeChart {
  note: string;
  rows: { label: string; cells: { name: string; value: string }[] }[];
  columns: string[];
}

const CELL_RE = /([가-힣]+)([\d.]+)/g;

export function parseSizeChart(raw: string): ParsedSizeChart | null {
  if (!raw || !raw.trim()) return null;
  const [head, ...body] = raw.split("—");
  const note = (head || "").trim();
  const text = body.join("—") || raw;
  const rows: ParsedSizeChart["rows"] = [];
  const columns: string[] = [];

  for (const part of text.split("/")) {
    const m = part.match(/^\s*([^:]+):\s*(.+)$/);
    if (!m) continue;
    const label = m[1].trim();
    const cells: { name: string; value: string }[] = [];
    m[2].replace(CELL_RE, (all: string, name: string, value: string) => {
      if (!columns.includes(name)) columns.push(name);
      cells.push({ name, value });
      return all;
    });
    if (label && cells.length) rows.push({ label, cells });
  }
  if (!rows.length) return null;
  return { note, rows, columns };
}

export default function SizeTable({ raw }: { raw: string }) {
  const parsed = parseSizeChart(raw);
  if (!parsed) return null;
  return (
    <div className={styles.sizeTable}>
      {parsed.note ? <p className={styles.sizeNote}>{parsed.note}</p> : null}
      <div className={styles.sizeScroll} role="table" aria-label="실측 사이즈">
        <table>
          <thead>
            <tr>
              <th scope="col">사이즈</th>
              {parsed.columns.map((c) => (
                <th key={c} scope="col">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {parsed.rows.map((r) => {
              const byName = Object.fromEntries(r.cells.map((c) => [c.name, c.value]));
              return (
                <tr key={r.label}>
                  <th scope="row">{r.label}</th>
                  {parsed.columns.map((c) => (
                    <td key={c}>{byName[c] ?? "—"}</td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
