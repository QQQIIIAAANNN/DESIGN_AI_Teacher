"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";

const questionCategories = [
  { value: "architectural_design", label: "建築設計" },
  { value: "site_planning", label: "敷地計畫" },
  { value: "civil_service_grade_3", label: "公務人員高考三級" },
  { value: "other", label: "其他" }
] as const;

type QuestionCategory = (typeof questionCategories)[number]["value"];
type FilterCategory = "all" | QuestionCategory;

type LocalQuestion = {
  id: string;
  year: number;
  category: QuestionCategory;
  title: string;
  fileName: string;
  size: number;
  url: string;
};

function categoryLabel(category: QuestionCategory) {
  return questionCategories.find((item) => item.value === category)?.label ?? "其他";
}

function formatFileSize(size: number) {
  if (size < 1024 * 1024) return Math.round(size / 1024) + " KB";
  return (size / (1024 * 1024)).toFixed(1) + " MB";
}

export default function QuestionBank() {
  const currentYear = new Date().getFullYear();
  const years = useMemo(
    () => Array.from({ length: currentYear - 1999 }, (_, index) => currentYear - index),
    [currentYear]
  );
  const [uploadYear, setUploadYear] = useState(String(currentYear));
  const [uploadCategory, setUploadCategory] = useState<QuestionCategory>("architectural_design");
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [questions, setQuestions] = useState<LocalQuestion[]>([]);
  const [filterYear, setFilterYear] = useState("all");
  const [filterCategory, setFilterCategory] = useState<FilterCategory>("all");
  const [notice, setNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const objectUrls = useRef<string[]>([]);

  useEffect(() => {
    return () => objectUrls.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  const filteredQuestions = useMemo(
    () =>
      questions.filter((question) => {
        const matchesYear = filterYear === "all" || String(question.year) === filterYear;
        const matchesCategory =
          filterCategory === "all" || question.category === filterCategory;
        return matchesYear && matchesCategory;
      }),
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

    setFile(picked);
    setTitle((current) => current || picked.name.slice(0, -4));
  }

  function handleAddQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) {
      setNotice({ kind: "error", text: "請先選擇一份 PDF 題目。" });
      return;
    }

    const url = URL.createObjectURL(file);
    objectUrls.current.push(url);
    const questionTitle = title.trim() || file.name.slice(0, -4);
    const record: LocalQuestion = {
      id: Date.now() + "-" + Math.random().toString(36).slice(2, 8),
      year: Number(uploadYear),
      category: uploadCategory,
      title: questionTitle,
      fileName: file.name,
      size: file.size,
      url
    };

    setQuestions((current) => [record, ...current]);
    setTitle("");
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setNotice({
      kind: "success",
      text:
        "已加入 " +
        uploadYear +
        " 年「" +
        categoryLabel(uploadCategory) +
        "」本機清單；重新整理頁面後會清空。"
    });
  }

  return (
    <section className="question-bank" aria-labelledby="question-bank-title">
      <div className="qb-heading">
        <div>
          <span className="step">QUESTION BANK</span>
          <h2 id="question-bank-title">歷年試題資料庫</h2>
          <p>依年度與考試類別整理 PDF 題目，為後續正式題庫建立一致索引。</p>
        </div>
        <span className="qb-local-chip">前端原型 · 本機暫存</span>
      </div>

      <div className="qb-layout">
        <form className="qb-upload-card" onSubmit={handleAddQuestion}>
          <div className="qb-card-heading">
            <span className="qb-step-number">01</span>
            <div>
              <h3>上傳題目 PDF</h3>
              <p>選擇年度、題型，再加入一份試題檔案。</p>
            </div>
          </div>

          <div className="qb-form-fields">
            <label className="qb-field">
              <span>題目年度</span>
              <select
                value={uploadYear}
                onChange={(event) => setUploadYear(event.target.value)}
              >
                {years.map((year) => (
                  <option key={year} value={String(year)}>
                    {year} 年
                  </option>
                ))}
              </select>
            </label>

            <label className="qb-field">
              <span>題目類別</span>
              <select
                value={uploadCategory}
                onChange={(event) =>
                  setUploadCategory(event.target.value as QuestionCategory)
                }
              >
                {questionCategories.map((category) => (
                  <option key={category.value} value={category.value}>
                    {category.label}
                  </option>
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
              aria-describedby="qb-local-note"
              onChange={handleFileChange}
            />
            <span className="qb-file-badge" aria-hidden="true">PDF</span>
            <span className="qb-file-copy">
              <strong>{file ? file.name : "選擇 PDF 題目"}</strong>
              <small>{file ? formatFileSize(file.size) + " · 準備加入本機清單" : "點選此處瀏覽檔案"}</small>
            </span>
            <span className="qb-file-action">{file ? "更換檔案" : "瀏覽"}</span>
          </label>

          <button className="qb-add-button" type="submit" disabled={!file}>
            加入本機題庫
          </button>
          <p id="qb-local-note" className="qb-local-note">
            測試版只在目前分頁暫存 PDF，不會傳到伺服器；重新整理後清空。
          </p>
          {notice && (
            <p
              className={"qb-feedback qb-" + notice.kind}
              role={notice.kind === "error" ? "alert" : "status"}
            >
              {notice.text}
            </p>
          )}
        </form>

        <div className="qb-library-card">
          <div className="qb-library-heading">
            <div>
              <h3>題目清單</h3>
              <p>{questions.length} 份本機暫存題目</p>
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
                  {years.map((year) => (
                    <option key={year} value={String(year)}>
                      {year} 年
                    </option>
                  ))}
                </select>
              </label>
              <label className="qb-filter">
                <span>題型</span>
                <select
                  aria-label="依題型篩選題目"
                  value={filterCategory}
                  onChange={(event) =>
                    setFilterCategory(event.target.value as FilterCategory)
                  }
                >
                  <option value="all">全部題型</option>
                  {questionCategories.map((category) => (
                    <option key={category.value} value={category.value}>
                      {category.label}
                    </option>
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
                      {question.year} 年 · {categoryLabel(question.category)} ·{" "}
                      {formatFileSize(question.size)}
                    </span>
                    <small>{question.fileName}</small>
                  </div>
                  <a
                    className="qb-preview-link"
                    href={question.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={"預覽 " + question.title + " PDF"}
                  >
                    預覽 PDF
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <div className="qb-empty-state">
              <span className="qb-empty-pdf" aria-hidden="true">PDF</span>
              <strong>
                {questions.length > 0 ? "沒有符合條件的題目" : "題目尚未加入"}
              </strong>
              <span>
                {questions.length > 0
                  ? "調整年度或題型篩選條件。"
                  : "從左側選取 PDF，加入本機測試清單。"}
              </span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
