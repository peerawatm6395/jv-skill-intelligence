"use client";

import { useState } from "react";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export function AssistantChat({ employees }: { employees: { employee_id: string; display_name: string }[] }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!question.trim()) return;

    const newMessages: ChatMessage[] = [...messages, { role: "user", content: question }];
    setMessages(newMessages);
    setQuestion("");
    setBusy(true);

    try {
      const res = await fetch("/api/ai/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, employeeId: employeeId || undefined }),
      });
      const data = await res.json();

      if (!res.ok) {
        setMessages([...newMessages, { role: "assistant", content: `⚠️ ${data.error}` }]);
      } else {
        const text =
          data.answer?.content?.find((c: { type: string; text?: string }) => c.type === "text")?.text ??
          "No response text returned.";
        setMessages([...newMessages, { role: "assistant", content: text }]);
      }
    } catch {
      setMessages([...newMessages, { role: "assistant", content: "⚠️ Request failed." }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-[600px] flex-col rounded-lg border border-gray-200 bg-white">
      <div className="border-b border-gray-200 p-3">
        <label className="text-xs text-gray-500">Focus on employee (optional)</label>
        <select
          value={employeeId}
          onChange={(e) => setEmployeeId(e.target.value)}
          className="ml-2 rounded border border-gray-300 px-2 py-1 text-xs"
        >
          <option value="">General question</option>
          {employees.map((e) => (
            <option key={e.employee_id} value={e.employee_id}>
              {e.display_name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {messages.length === 0 && (
          <p className="text-sm text-gray-400">
            Ask about workforce data — e.g. &quot;What is this employee&apos;s CM Skill evidence
            based on?&quot; Every answer states which layer and evidence type it rests on.
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "text-right" : "text-left"}>
            <span
              className={
                m.role === "user"
                  ? "inline-block max-w-[80%] rounded-lg bg-indigo-600 px-3 py-2 text-sm text-white"
                  : "inline-block max-w-[80%] rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-800 whitespace-pre-wrap"
              }
            >
              {m.content}
            </span>
          </div>
        ))}
        {busy && <p className="text-xs text-gray-400">Thinking…</p>}
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2 border-t border-gray-200 p-3">
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask a question…"
          className="flex-1 rounded border border-gray-300 px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={busy || !question.trim()}
          className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  );
}
