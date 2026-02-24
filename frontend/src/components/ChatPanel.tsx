import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export interface Message {
  role: "user" | "assistant";
  text: string;
  sources?: string[];
}

interface ChatPanelProps {
  messages: Message[];
  onAsk: (question: string) => Promise<void>;
  loading: boolean;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
}

const HINTS = [
  "What drives the forecast peak?",
  "Explain the uncertainty band.",
  "Are there any anomalies to watch?",
];

export function ChatPanel({ messages, onAsk, loading, isExpanded = false, onToggleExpand }: ChatPanelProps) {
  const [question, setQuestion] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const handleSend = async () => {
    const q = question.trim();
    if (!q) return;
    setQuestion("");
    await onAsk(q);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey && question.trim() && !loading) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <section className="card chat-card">
      <div className="card-header">
        <span className="card-icon">🤖</span>
        <h2 className="card-title">AI Analyst</h2>
        {onToggleExpand && (
          <button className="btn-panel-expand" onClick={onToggleExpand} title={isExpanded ? "Restore" : "Expand"} style={{ marginLeft: "auto" }}>
            {isExpanded ? "⤡" : "⤢"}
          </button>
        )}
      </div>

      <div className="chat-messages">
        {messages.length === 0 && !loading && (
          <div className="chat-empty">
            <span className="chat-empty-icon">💬</span>
            <div className="hint-chips">
              {HINTS.map((h) => (
                <button key={h} className="hint-chip" onClick={() => setQuestion(h)}>
                  {h}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, idx) => (
          <div key={`${m.role}-${idx}`} className={`msg ${m.role}`}>
            {m.role === "assistant" ? (
              <div className="msg-md">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {m.text}
                </ReactMarkdown>
              </div>
            ) : (
              <div>{m.text}</div>
            )}
            {m.sources && m.sources.length > 0 && (
              <div className="msg-sources">
                {m.sources.map((s) => (
                  <span key={s} className="source-tag">{s}</span>
                ))}
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div className="typing-bubble">
            <div className="typing-dots">
              <span /><span /><span />
            </div>
          </div>
        )}

        <div ref={endRef} />
      </div>

      <div className="chat-input-row">
        <input
          className="chat-input"
          type="text"
          placeholder="Ask about patterns, peaks, anomalies…"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={loading}
        />
        <button
          className="btn-send"
          disabled={!question.trim() || loading}
          onClick={handleSend}
        >
          {loading ? "…" : "Send ↑"}
        </button>
      </div>
    </section>
  );
}
