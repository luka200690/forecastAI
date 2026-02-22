import { useState } from "react";

export interface Message {
  role: "user" | "assistant";
  text: string;
  sources?: string[];
}

interface ChatPanelProps {
  messages: Message[];
  onAsk: (question: string) => Promise<void>;
  loading: boolean;
}

export function ChatPanel({ messages, onAsk, loading }: ChatPanelProps) {
  const [question, setQuestion] = useState("");

  return (
    <section className="card">
      <h2>Chat</h2>
      <div className="chat-box">
        {messages.map((m, idx) => (
          <div key={`${m.role}-${idx}`} className={`msg ${m.role}`}>
            <div>{m.text}</div>
            {m.sources && m.sources.length > 0 && <small>Sources: {m.sources.join(", ")}</small>}
          </div>
        ))}
      </div>
      <div className="row">
        <input
          type="text"
          placeholder='Ask: "why is it higher on Tuesday?"'
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
        />
        <button
          disabled={!question.trim() || loading}
          onClick={async () => {
            const q = question.trim();
            await onAsk(q);
            setQuestion("");
          }}
        >
          {loading ? "Sending..." : "Send"}
        </button>
      </div>
    </section>
  );
}
