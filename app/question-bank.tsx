"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import {
  questionBankCatalog,
  type ProjectQuestion,
  type QuestionCategory
} from "@/data/question-bank";

const questionCategories: Array<{ value: QuestionCategory; label: string }> = [
  { value: "architectural_design", label: "建築設計" },
  { value: "site_planning", label: "敷地計畫" },
  { value: "civil_service_grade_3", label: "公務人員高考三級" }
];

type FilterCategory = "all" | QuestionCategory;

type QuestionRecord = ProjectQuestion & {
  fileName?: string;
  size: number;
  url: string;
  sourceType: "catalog" | "local";
};

function categoryLabel(category: QuestionCategory) {
  return questionCategories.find((item) => item.value === category)?.label ?? "其他";
}

function formatFileSize(size: number) {
  if (!size) return "官方來源";
  if (size < 1024 * 1024) return Math.round(size / 1024) + " KB";
  return (size / (1024 * 1024)).toFixed(1) + " MB";
}


export function QuestionSelector({
  onSelect
}: {
  onSelect: (question: ProjectQuestion) => void;
}) {
  const years = useMemo(
    () => Array.from({ length: 25 }, (_, index) => 114 - index),
    []
  );
  const [year, setYear] = useState("114");
  const [category, setCategory] = useState<QuestionCategory>("architectural_design");
  const selected = useMemo(
    () =>
      questionBankCatalog.find(
        (question) => question.year === Number(year) && question.category === category
      ) ?? null,
    [category, year]
  );

  useEffect(() => {
    if (selected) onSelect(selected);
  }, [onSelect, selected]);

  return (
    <section className="question-selector-card" aria-labelledby="question-selector-title">
      <div className="question-selector-heading">
        <div>
          <span className="step">02 · REVIEW TARGET</span>
          <h2 id="question-selector-title">選擇本次檢討題目</h2>
          <p>先指定年份與題型，審圖時會以這一題作為練習脈絡。</p>
        </div>
        <span className="qb-local-chip">90–114 年</span>
      </div>

      <div className="question-selector-fields">
        <label className="qb-field">
          <span>題目年度</span>
          <select value={year} onChange={(event) => setYear(event.target.value)}>
            {years.map((item) => (
              <option key={item} value={String(item)}>{item} 年</option>
            ))}
          </select>
        </label>
        <label className="qb-field">
          <span>題目類別</span>
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value as QuestionCategory)}
          >
            {questionCategories.map((item) => (
              <option key={item.value} value={item.value}>{item.label}</option>
            ))}
          </select>
        </label>
      </div>

      {selected ? (
        <div className="selected-question-card">
          <div>
            <span>{selected.year} 年 · {categoryLabel(selected.category)} · {selected.topic}</span>
            <strong>{selected.title}</strong>
          </div>
          <a
            href={selected.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            開啟題目 PDF
          </a>
        </div>
      ) : (
        <p className="question-selector-empty">這個年份目前沒有該題型索引。</p>
      )}

      <QuestionBank compact />
    </section>
  );
}

export default function QuestionBank({ compact = false }: { compact?: boolean }) {
  const years = useMemo(
    () => Array.from({ length: 25 }, (_, index) => 114 - index),
    []
  );
  const catalogQuestions = useMemo<QuestionRecord[]>(
    () =>
      questionBankCatalog.map((question) => ({
        ...question,
        size: 0,
        url: question.sourceUrl,
        sourceType: "catalog" as const
      })),
    []
  );
  const [uploadYear, setUploadYear] = useState("114");
  const [uploadCategory, setUploadCategory] = useState<QuestionCategory>("architectural_design");
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [localQuestions, setLocalQuestions] = useState<QuestionRecord[]>([]);
  const [filterYear, setFilterYear] = useState("all");
  const [filterCategory, setFilterCategory] = useState<FilterCategory>("all");
  const [notice, setNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const objectUrls = useRef<string[]>([]);

  const questions = useMemo(
    () => [...catalogQuestions, ...localQuestions],
    [catalogQuestions, localQuestions]
  );
  const filteredQuestions = useMemo(
    () =>
      questions
        .filter((question) => {
          const matchesYear = filterYear === "all" || String(question.year) === filterYear;
          const matchesCategory = filterCategory === "all" || question.category === filterCategory;
          return matchesYear && matchesCategory;
        })
        .sort((a, b) => b.year - a.year || a.category.localeCompare(b.category)),
    [filterCategory, filterYear, questions]
  );

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const picked = input.files?.[0] ?? null;
    setNotice(null);
    if (!picked) {
      setFile(null);
      return;
    }
    const isPdf =
      picked.type === "application/pdf" || picked.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) {
      setFile(null);
      setNotice({ kind: "error", text: "請選擇 PDF 檔案。" });
      input.value = "";
      return;
    }
    if (picked.size > 25 * 1024 * 1024) {
      setFile(null);
      setNotice({ kind: "error", text: "PDF 超過 25 MB，請先縮小檔案。" });
      input.value = "";
      return;
    }
    setFile(picked);
    setTitle((current) => current || picked.name.replace(/\.pdf$/i, ""));
  }

  function handleAddQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) {
      setNotice({ kind: "error", text: "請先選擇一份 PDF 題目。" });
      return;
    }
    setIsBusy(true);
    const url = URL.createObjectURL(file);
    objectUrls.current.push(url);
    const questionTitle = title.trim() || file.name.replace(/\.pdf$/i, "");
    const record: QuestionRecord = {
      id: "local-" + crypto.randomUUID(),
      year: Number(uploadYear),
      category: uploadCategory,
      title: questionTitle,
      topic: "自訂題目",
      sourceUrl: "",
      sourceLabel: "目前瀏覽器暫存",
      sourceArticleUrl: "",
      licenseNote: "此檔案尚未寫入專案；請自行確認授權。",
      fileName: file.name,
      size: file.size,
      url,
      sourceType: "local"
    };
    setLocalQuestions((current) => [record, ...current]);
    setTitle("");
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setNotice({
      kind: "success",
      text: "已加入目前瀏覽器的自訂題目；若要成為專案題庫，請把檔案與索引交由維護者審核後提交。"
    });
    setIsBusy(false);
  }

  return (
    <section
      className={compact ? "question-bank question-bank-compact" : "question-bank"}
      aria-labelledby="question-bank-title"
    >
      {compact ? (
        <div className="qb-compact-heading">
          <div>
            <span className="step">QUESTION BANK</span>
            <h3 id="question-bank-title">歷年試題資料庫</h3>
          </div>
          <span className="qb-local-chip">{questions.length} 份索引</span>
        </div>
      ) : (
        <div className="qb-heading">
          <div>
            <span className="step">QUESTION BANK</span>
            <h2 id="question-bank-title">歷年試題資料庫</h2>
            <p>專案內建民國 90–114 年建築設計、敷地計畫與公務人員高考三級索引。</p>
          </div>
          <span className="qb-local-chip">專案內建索引 · 外部官方 PDF</span>
        </div>
      )}

      {!compact && (
        <div className="qb-source-note">
          題目索引來源：
          <a href="https://vocus.cc/article/66d08494fd89780001ee494f" target="_blank" rel="noopener noreferrer">
            施明宏建築師的歷屆考題索引
          </a>
          。目前保留官方來源連結，不把未確認授權的 PDF 複製進公開專案。
        </div>
      )}

      <div className="qb-layout">
        <details className="qb-extension">
          <summary className="qb-extension-summary">
            <span>延伸功能：新增自訂題目 PDF</span>
            <span>展開</span>
          </summary>
        <form className="qb-upload-card" onSubmit={handleAddQuestion}>
          <div className="qb-card-heading">
            <span className="qb-step-number">01</span>
            <div>
              <h3>新增自訂題目 PDF</h3>
              <p>可先在目前瀏覽器預覽，不會自動上傳 Supabase 或公開到 GitHub。</p>
            </div>
          </div>

          <div className="qb-form-fields">
            <label className="qb-field">
              <span>題目年度</span>
              <select value={uploadYear} onChange={(event) => setUploadYear(event.target.value)}>
                {years.map((year) => (
                  <option key={year} value={String(year)}>{year} 年</option>
                ))}
              </select>
            </label>

            <label className="qb-field">
              <span>題目類別</span>
              <select
                value={uploadCategory}
                onChange={(event) => setUploadCategory(event.target.value as QuestionCategory)}
              >
                {questionCategories.map((category) => (
                  <option key={category.value} value={category.value}>{category.label}</option>
                ))}
              </select>
            </label>

            <label className="qb-field qb-title-field">
              <span>題目名稱</span>
              <input
                type="text"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="例：建築設計試題"
              />
            </label>
          </div>

          <label className="qb-file-drop">
            <input
              ref={fileInputRef}
              className="qb-visually-hidden"
              type="file"
              accept="application/pdf,.pdf"
              onChange={handleFileChange}
            />
            <span className="qb-file-badge" aria-hidden="true">PDF</span>
            <span className="qb-file-copy">
              <strong>{file ? file.name : "選擇 PDF 題目"}</strong>
              <small>{file ? formatFileSize(file.size) + " · 準備加入" : "點選此處瀏覽檔案"}</small>
            </span>
            <span className="qb-file-action">{file ? "更換檔案" : "瀏覽"}</span>
          </label>

          <button className="qb-add-button" type="submit" disabled={!file || isBusy}>
            {isBusy ? "處理中…" : "加入目前題目清單"}
          </button>
          <p className="qb-local-note">
            這個按鈕只建立本機預覽；要寫入專案，仍需將 PDF 授權與 metadata 一起提交審核。
          </p>
        </form>
        </details>

        <div className="qb-library-card">
          <div className="qb-library-heading">
            <div>
              <h3>題目清單</h3>
              <p>{questions.length} 份專案索引／本機暫存題目</p>
            </div>
            <div className="qb-filters">
              <label className="qb-filter">
                <span>年度</span>
                <select
                  aria-label="依年度篩選題目"
                  value={filterYear}
                  onChange={(event) => setFilterYear(event.target.value)}
                >
                  <option value="all">全部年度</option>
                  {years.map((year) => <option key={year} value={String(year)}>{year} 年</option>)}
                </select>
              </label>
              <label className="qb-filter">
                <span>題型</span>
                <select
                  aria-label="依題型篩選題目"
                  value={filterCategory}
                  onChange={(event) => setFilterCategory(event.target.value as FilterCategory)}
                >
                  <option value="all">全部題型</option>
                  {questionCategories.map((category) => (
                    <option key={category.value} value={category.value}>{category.label}</option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          {filteredQuestions.length > 0 ? (
            <ul className="qb-record-list">
              {filteredQuestions.map((question) => (
                <li className="qb-record" key={question.id}>
                  <span className="qb-record-badge" aria-hidden="true">PDF</span>
                  <div className="qb-record-copy">
                    <strong>{question.title}</strong>
                    <span>
                      {question.year} 年 · {categoryLabel(question.category)} · {question.topic} · {formatFileSize(question.size)}
                    </span>
                    <small>{question.fileName || question.sourceLabel}</small>
                  </div>
                  {question.url ? (
                    <a
                      className="qb-preview-link"
                      href={question.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={"開啟 " + question.title + " PDF"}
                    >
                      {question.sourceType === "catalog" ? "開啟官方 PDF" : "預覽 PDF"}
                    </a>
                  ) : (
                    <span className="qb-preview-unavailable">暫無預覽</span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <div className="qb-empty-state">
              <span className="qb-empty-pdf" aria-hidden="true">PDF</span>
              <strong>沒有符合條件的題目</strong>
              <span>調整年度或題型篩選條件。</span>
            </div>
          )}
        </div>
      </div>

      {notice && (
        <p className={"qb-feedback qb-" + notice.kind} role={notice.kind === "error" ? "alert" : "status"}>
          {notice.text}
        </p>
      )}
    </section>
  );
}
