"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import {
  canCurateQuestionBank,
  publishQuestionPaper,
  createQuestionSignedUrl,
  getSavedSession,
  isActiveMember,
  isSupabaseConfigured,
  listQuestionPapers,
  requestEmailOtp,
  signOutSupabase,
  uploadQuestionPaper,
  verifyEmailOtp
} from "@/lib/supabase-browser";
import type {
  QuestionExamType,
  SupabaseBrowserSession
} from "@/lib/supabase-browser";

const questionCategories: Array<{ value: QuestionExamType; label: string }> = [
  { value: "architectural_design", label: "建築設計" },
  { value: "site_planning", label: "敷地計畫" },
  { value: "civil_service_grade_3", label: "公務人員高考三級" },
  { value: "other", label: "其他" }
];

type FilterCategory = "all" | QuestionExamType;
type AuthState = "loading" | "signed_out" | "active" | "inactive";

type QuestionRecord = {
  id: string;
  year: number;
  category: QuestionExamType;
  title: string;
  fileName: string;
  size: number;
  url: string;
  status: "draft" | "published";
};

function categoryLabel(category: QuestionExamType) {
  return questionCategories.find((item) => item.value === category)?.label ?? "其他";
}

function formatFileSize(size: number) {
  if (size < 1024 * 1024) return Math.round(size / 1024) + " KB";
  return (size / (1024 * 1024)).toFixed(1) + " MB";
}

export default function QuestionBank() {
  const cloudEnabled = isSupabaseConfigured();
  const currentYear = new Date().getFullYear();
  const years = useMemo(
    () => Array.from({ length: currentYear - 1999 }, (_, index) => currentYear - index),
    [currentYear]
  );
  const [uploadYear, setUploadYear] = useState(String(currentYear));
  const [uploadCategory, setUploadCategory] = useState<QuestionExamType>("architectural_design");
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [localQuestions, setLocalQuestions] = useState<QuestionRecord[]>([]);
  const [remoteQuestions, setRemoteQuestions] = useState<QuestionRecord[]>([]);
  const [filterYear, setFilterYear] = useState("all");
  const [filterCategory, setFilterCategory] = useState<FilterCategory>("all");
  const [notice, setNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [authState, setAuthState] = useState<AuthState>(cloudEnabled ? "loading" : "signed_out");
  const [session, setSession] = useState<SupabaseBrowserSession | null>(null);
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [isLoadingQuestions, setIsLoadingQuestions] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const objectUrls = useRef<string[]>([]);

  useEffect(() => {
    return () => objectUrls.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  async function loadRemoteQuestions(activeSession: SupabaseBrowserSession) {
    setIsLoadingQuestions(true);
    try {
      const rows = await listQuestionPapers(activeSession);
      const records = await Promise.all(rows.map(async (row) => {
        let url = "";
        try {
          url = await createQuestionSignedUrl(activeSession, row.storage_path);
        } catch {
          // Metadata remains visible; the user can retry after access is restored.
        }
        return {
          id: row.id,
          year: row.exam_year,
          category: row.exam_type,
          title: row.title,
          fileName: row.original_filename,
          size: Number(row.size_bytes),
          url,
          status: row.status === "draft" ? "draft" : "published"
        };
      }));
      setRemoteQuestions(records);
    } catch (error) {
      setNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "無法載入正式題庫。"
      });
    } finally {
      setIsLoadingQuestions(false);
    }
  }

  useEffect(() => {
    if (!cloudEnabled) return;
    let cancelled = false;
    void (async () => {
      const saved = await getSavedSession();
      if (cancelled) return;
      setSession(saved);
      if (!saved) {
        setAuthState("signed_out");
        return;
      }
      if (!isActiveMember(saved.user)) {
        setAuthState("inactive");
        return;
      }
      setAuthState("active");
      await loadRemoteQuestions(saved);
    })();
    return () => {
      cancelled = true;
    };
  }, [cloudEnabled]);

  const questions = cloudEnabled ? remoteQuestions : localQuestions;
  const canUpload = !cloudEnabled || (
    authState === "active" && canCurateQuestionBank(session?.user)
  );
  const filteredQuestions = useMemo(
    () =>
      questions.filter((question) => {
        const matchesYear = filterYear === "all" || String(question.year) === filterYear;
        const matchesCategory = filterCategory === "all" || question.category === filterCategory;
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
    if (picked.size > 25 * 1024 * 1024) {
      setFile(null);
      setNotice({ kind: "error", text: "PDF 超過 25 MB，請先縮小檔案。" });
      input.value = "";
      return;
    }

    setFile(picked);
    setTitle((current) => current || picked.name.replace(/\.pdf$/i, ""));
  }

  async function handleAddQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) {
      setNotice({ kind: "error", text: "請先選擇一份 PDF 題目。" });
      return;
    }

    const questionTitle = title.trim() || file.name.replace(/\.pdf$/i, "");
    if (cloudEnabled) {
      if (!session || authState !== "active" || !canCurateQuestionBank(session.user)) {
        setNotice({ kind: "error", text: "只有已核准的題庫整理者可以上傳題目。" });
        return;
      }
      setIsBusy(true);
      setNotice(null);
      try {
        const row = await uploadQuestionPaper(session, {
          year: Number(uploadYear),
          category: uploadCategory,
          title: questionTitle,
          file
        });
        let url = "";
        try {
          url = await createQuestionSignedUrl(session, row.storage_path);
        } catch {
          // The private record is still saved; the signed preview can be retried later.
        }
        setRemoteQuestions((current) => [{
          id: row.id,
          year: row.exam_year,
          category: row.exam_type,
          title: row.title,
          fileName: row.original_filename,
          size: Number(row.size_bytes),
          url,
          status: "draft"
        }, ...current]);
        setNotice({
          kind: "success",
          text: "PDF 已存入私有題庫草稿；完成授權與內容檢查後，再按「發布題目」。"
        });
        setTitle("");
        setFile(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
      } catch (error) {
        setNotice({
          kind: "error",
          text: error instanceof Error ? error.message : "題目上傳失敗。"
        });
      } finally {
        setIsBusy(false);
      }
      return;
    }

    const url = URL.createObjectURL(file);
    objectUrls.current.push(url);
    const record: QuestionRecord = {
      id: Date.now() + "-" + Math.random().toString(36).slice(2, 8),
      year: Number(uploadYear),
      category: uploadCategory,
      title: questionTitle,
      fileName: file.name,
      size: file.size,
      url,
      status: "published"
    };
    setLocalQuestions((current) => [record, ...current]);
    setTitle("");
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setNotice({
      kind: "success",
      text: "已加入 " + uploadYear + " 年「" + categoryLabel(uploadCategory) + "」本機清單；重新整理頁面後會清空。"
    });
  }

  async function handleRequestCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsBusy(true);
    setNotice(null);
    try {
      await requestEmailOtp(email);
      setOtpSent(true);
      setNotice({
        kind: "success",
        text: "若此信箱已由管理員邀請，請查收登入碼，再於下方輸入。"
      });
    } catch (error) {
      setNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "無法寄送登入碼。"
      });
    } finally {
      setIsBusy(false);
    }
  }

  async function handleVerifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsBusy(true);
    setNotice(null);
    try {
      const signedIn = await verifyEmailOtp(email, otp);
      setSession(signedIn);
      if (!isActiveMember(signedIn.user)) {
        setAuthState("inactive");
        setNotice({
          kind: "error",
          text: "登入成功，但此帳號尚未核准。請聯絡平台管理員。"
        });
        return;
      }
      setAuthState("active");
      await loadRemoteQuestions(signedIn);
      setNotice({ kind: "success", text: "已連線 Supabase 私有題庫。" });
      setOtp("");
      setOtpSent(false);
    } catch (error) {
      setNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "登入驗證失敗。"
      });
    } finally {
      setIsBusy(false);
    }
  }

  async function handlePublishQuestion(question: QuestionRecord) {
    if (!session || !canCurateQuestionBank(session.user)) return;
    setIsBusy(true);
    setNotice(null);
    try {
      const published = await publishQuestionPaper(session, question.id);
      setRemoteQuestions((current) => current.map((item) =>
        item.id === question.id
          ? { ...item, status: published.status === "published" ? "published" : "draft" }
          : item
      ));
      setNotice({ kind: "success", text: "題目已發布給所有已核准帳號。" });
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "題目發布失敗。" });
    } finally {
      setIsBusy(false);
    }
  }

  async function handleSignOut() {
    setIsBusy(true);
    await signOutSupabase(session);
    setSession(null);
    setRemoteQuestions([]);
    setAuthState("signed_out");
    setOtp("");
    setOtpSent(false);
    setNotice({ kind: "success", text: "已登出正式題庫。" });
    setIsBusy(false);
  }

  return (
    <section className="question-bank" aria-labelledby="question-bank-title">
      <div className="qb-heading">
        <div>
          <span className="step">QUESTION BANK</span>
          <h2 id="question-bank-title">歷年試題資料庫</h2>
          <p>依年度與考試類別整理 PDF 題目，為後續正式題庫建立一致索引。</p>
        </div>
        <span className="qb-local-chip">
          {cloudEnabled ? "Supabase 私有題庫" : "前端原型 · 本機暫存"}
        </span>
      </div>

      {cloudEnabled && (
        <div className="qb-auth-panel">
          {authState === "loading" ? (
            <p>正在確認私有題庫登入狀態…</p>
          ) : authState === "active" ? (
            <div className="qb-auth-row">
              <div>
                <strong>已連線 Supabase</strong>
                <span>{session?.user.email || "已核准帳號"} · {canCurateQuestionBank(session?.user) ? "題庫整理者" : "可讀取題庫"}</span>
              </div>
              <button type="button" className="qb-auth-button" onClick={() => void handleSignOut()} disabled={isBusy}>
                登出
              </button>
            </div>
          ) : authState === "inactive" ? (
            <div className="qb-auth-row">
              <div>
                <strong>帳號尚未核准</strong>
                <span>{session?.user.email || "此帳號"}目前尚未取得題庫權限，請聯絡平台管理員。</span>
              </div>
              <button type="button" className="qb-auth-button" onClick={() => void handleSignOut()} disabled={isBusy}>
                登出
              </button>
            </div>
          ) : (
            <div className="qb-auth-form">
              <div>
                <strong>登入私有題庫</strong>
                <span>僅接受管理員已邀請並核准的帳號，不開放自行註冊。</span>
              </div>
              {!otpSent ? (
                <form onSubmit={handleRequestCode}>
                  <label>
                    <span>電子郵件</span>
                    <input
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="name@example.com"
                      required
                    />
                  </label>
                  <button className="qb-auth-button" type="submit" disabled={isBusy}>
                    {isBusy ? "寄送中…" : "寄送登入碼"}
                  </button>
                </form>
              ) : (
                <form onSubmit={handleVerifyCode}>
                  <label>
                    <span>電子郵件登入碼</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      value={otp}
                      onChange={(event) => setOtp(event.target.value)}
                      placeholder="輸入 6 位數登入碼"
                      required
                    />
                  </label>
                  <div className="qb-auth-actions">
                    <button className="qb-auth-button" type="submit" disabled={isBusy}>
                      {isBusy ? "驗證中…" : "驗證並登入"}
                    </button>
                    <button
                      className="qb-auth-text-button"
                      type="button"
                      onClick={() => { setOtpSent(false); setOtp(""); }}
                      disabled={isBusy}
                    >
                      更換信箱
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}
        </div>
      )}

      <div className="qb-layout">
        {canUpload ? (
          <form className="qb-upload-card" onSubmit={handleAddQuestion}>
            <div className="qb-card-heading">
              <span className="qb-step-number">01</span>
              <div>
                <h3>{cloudEnabled ? "上傳題目 PDF" : "上傳題目 PDF"}</h3>
                <p>選擇年度、題型，再加入一份試題檔案。</p>
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
                  onChange={(event) => setUploadCategory(event.target.value as QuestionExamType)}
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
                aria-describedby="qb-local-note"
                onChange={handleFileChange}
              />
              <span className="qb-file-badge" aria-hidden="true">PDF</span>
              <span className="qb-file-copy">
                <strong>{file ? file.name : "選擇 PDF 題目"}</strong>
                <small>{file ? formatFileSize(file.size) + " · 準備上傳" : "點選此處瀏覽檔案"}</small>
              </span>
              <span className="qb-file-action">{file ? "更換檔案" : "瀏覽"}</span>
            </label>

            <button className="qb-add-button" type="submit" disabled={!file || isBusy}>
              {isBusy ? "處理中…" : cloudEnabled ? "上傳至私有題庫" : "加入本機題庫"}
            </button>
            <p id="qb-local-note" className="qb-local-note">
              {cloudEnabled
                ? "PDF 會上傳至 Supabase 私有儲存空間，僅限已核准帳號讀取；請確認你有權整理此題目。"
                : "測試版只在目前分頁暫存 PDF，不會傳到伺服器；重新整理後清空。"}
            </p>
          </form>
        ) : (
          <div className="qb-upload-card qb-upload-locked">
            <span className="qb-step-number">01</span>
            <div>
              <h3>{authState === "active" ? "題庫整理權限" : "登入後使用私有題庫"}</h3>
              <p>
                {authState === "active"
                  ? "目前帳號可讀取題庫；PDF 上傳由管理員或題庫整理者負責。"
                  : "登入並取得管理員核准後，才能查看正式題庫。"}
              </p>
            </div>
          </div>
        )}

        <div className="qb-library-card">
          <div className="qb-library-heading">
            <div>
              <h3>題目清單</h3>
              <p>
                {cloudEnabled
                  ? authState === "active"
                    ? remoteQuestions.length + " 份正式題庫題目"
                    : "私有資料，登入後顯示"
                  : localQuestions.length + " 份本機暫存題目"}
              </p>
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

          {isLoadingQuestions ? (
            <div className="qb-empty-state"><strong>正在載入題庫…</strong></div>
          ) : filteredQuestions.length > 0 ? (
            <ul className="qb-record-list">
              {filteredQuestions.map((question) => (
                <li className="qb-record" key={question.id}>
                  <span className="qb-record-badge" aria-hidden="true">PDF</span>
                  <div className="qb-record-copy">
                    <strong>{question.title}</strong>
                    <span>
                      {question.year} 年 · {categoryLabel(question.category)} · {formatFileSize(question.size)}
                    </span>
                    <small>{question.fileName}</small>
                    {question.status === "draft" && <span className="qb-draft-chip">待審核草稿</span>}
                  </div>
                  {question.url ? (
                    <a
                      className="qb-preview-link"
                      href={question.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={"預覽 " + question.title + " PDF"}
                    >
                      預覽 PDF
                    </a>
                  ) : (
                    <span className="qb-preview-unavailable">暫無預覽</span>
                  )}
                  {cloudEnabled && question.status === "draft" && canCurateQuestionBank(session?.user) && (
                    <button
                      className="qb-publish-button"
                      type="button"
                      disabled={isBusy}
                      onClick={() => void handlePublishQuestion(question)}
                    >
                      發布題目
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <div className="qb-empty-state">
              <span className="qb-empty-pdf" aria-hidden="true">PDF</span>
              <strong>
                {questions.length > 0 ? "沒有符合條件的題目" : cloudEnabled && authState !== "active" ? "請先登入私有題庫" : "題目尚未加入"}
              </strong>
              <span>
                {questions.length > 0
                  ? "調整年度或題型篩選條件。"
                  : cloudEnabled && authState === "active"
                    ? "目前正式題庫還沒有已發布的題目。"
                    : cloudEnabled
                      ? "從上方使用已核准的帳號登入。"
                      : "從左側選取 PDF，加入本機測試清單。"}
              </span>
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
