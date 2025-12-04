"use client";

import { useEffect, useState } from "react";
import { db } from "../../lib/firebase"; // path relative to src/app/inbox
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  doc,
  updateDoc,
} from "firebase/firestore";

export default function InboxPage() {
  const [conversations, setConversations] = useState([]);
  const [selectedConv, setSelectedConv] = useState(null);
  const [messages, setMessages] = useState([]);
  const [agentMessage, setAgentMessage] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isTogglingAI, setIsTogglingAI] = useState(false);

  const tenantId = "demo-company";

  useEffect(() => {
    const convRef = collection(db, "companies", tenantId, "conversations");
    const q = query(convRef, orderBy("lastUpdated", "desc"));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      setConversations(
        snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
      );
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!selectedConv) return;

    const messagesRef = collection(
      db,
      "companies",
      tenantId,
      "conversations",
      selectedConv.id,
      "messages"
    );

    const q = query(messagesRef, orderBy("createdAt", "asc"));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      setMessages(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    });

    return () => unsubscribe();
  }, [selectedConv]);

  const apiBase =
    process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:4000";

  async function handleToggleAI() {
    if (!selectedConv) return;
    try {
      setIsTogglingAI(true);
      const current = selectedConv.aiEnabled !== false; // missing => true
      const enable = !current;

      const resp = await fetch(`${apiBase}/agent/toggle-ai`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          convId: selectedConv.id,
          enable,
        }),
      });

      if (!resp.ok) {
        const txt = await resp.text();
        console.error("Error toggling AI:", txt);
        alert("Failed to toggle AI. Check API logs for details.");
      } else {
        setSelectedConv({ ...selectedConv, aiEnabled: enable });
      }
    } catch (err) {
      console.error("Error toggling AI:", err);
      alert("Failed to toggle AI for this conversation.");
    } finally {
      setIsTogglingAI(false);
    }
  }

  async function handleSendAgentMessage(e) {
    e?.preventDefault();
    if (!selectedConv || !agentMessage.trim()) return;

    try {
      setIsSending(true);
      const resp = await fetch(`${apiBase}/agent/send-message`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          convId: selectedConv.id,
          body: agentMessage.trim(),
        }),
      });

      if (!resp.ok) {
        const errText = await resp.text();
        console.error("Error sending agent message:", errText);
        alert("Failed to send message. Check API logs for details.");
      } else {
        setAgentMessage("");
      }
    } catch (err) {
      console.error("Error sending agent message:", err);
      alert("Failed to send message. Check console for details.");
    } finally {
      setIsSending(false);
    }
  }

  return (
    <div style={{ display: "flex", height: "100vh" }}>
      <div
        style={{
          width: "320px",
          borderRight: "1px solid #ccc",
          padding: "1rem",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <h2>Conversations</h2>
        <div style={{ flex: 1, overflowY: "auto", marginTop: "0.5rem" }}>
          {conversations.map((conv) => (
            <div
              key={conv.id}
              style={{
                padding: "0.5rem",
                cursor: "pointer",
                backgroundColor: selectedConv?.id === conv.id ? "#e0f7fa" : "",
                borderRadius: "4px",
                marginBottom: "0.25rem",
              }}
              onClick={() => setSelectedConv(conv)}
            >
              <div style={{ fontWeight: 500 }}>
                {conv.participants?.[0] || "Unknown"}
              </div>
              <div style={{ fontSize: "0.75rem", color: "#666" }}>
                {conv.lastUpdated
                  ? new Date(conv.lastUpdated.seconds * 1000).toLocaleString()
                  : ""}
              </div>
            </div>
          ))}
        </div>

        {selectedConv && (
          <div
            style={{
              marginTop: "0.75rem",
              paddingTop: "0.5rem",
              borderTop: "1px solid #eee",
            }}
          >
            <div style={{ fontSize: "0.85rem", marginBottom: "0.25rem" }}>
              <strong>AI status:</strong>{" "}
              {selectedConv.aiEnabled === false ? "Off" : "On"}
            </div>
            <button
              onClick={handleToggleAI}
              disabled={isTogglingAI}
              style={{
                padding: "0.35rem 0.75rem",
                fontSize: "0.85rem",
                borderRadius: "4px",
                border: "1px solid #ccc",
                backgroundColor:
                  selectedConv.aiEnabled === false ? "#e0f7fa" : "#ffe0e0",
                cursor: isTogglingAI ? "default" : "pointer",
              }}
            >
              {isTogglingAI
                ? "Updating..."
                : selectedConv.aiEnabled === false
                ? "Turn AI On"
                : "Turn AI Off"}
            </button>
          </div>
        )}
      </div>

      <div
        style={{
          flex: 1,
          padding: "1rem",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <h2>Messages</h2>
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            marginTop: "0.5rem",
            paddingRight: "0.5rem",
          }}
        >
          {selectedConv ? (
            messages.map((msg) => (
              <div key={msg.id} style={{ marginBottom: "0.5rem" }}>
                <strong>{msg.from}</strong>:{" "}
                {msg.body || JSON.stringify(msg.payload)}
              </div>
            ))
          ) : (
            <p>Select a conversation</p>
          )}
        </div>

        {selectedConv && (
          <form
            onSubmit={handleSendAgentMessage}
            style={{
              marginTop: "0.5rem",
              display: "flex",
              gap: "0.5rem",
            }}
          >
            <input
              type="text"
              placeholder="Type a reply as agent..."
              value={agentMessage}
              onChange={(e) => setAgentMessage(e.target.value)}
              style={{
                flex: 1,
                padding: "0.5rem",
                borderRadius: "4px",
                border: "1px solid #ccc",
              }}
            />
            <button
              type="submit"
              disabled={isSending || !agentMessage.trim()}
              style={{
                padding: "0.5rem 1rem",
                borderRadius: "4px",
                border: "none",
                backgroundColor: "#1976d2",
                color: "white",
                cursor:
                  isSending || !agentMessage.trim() ? "not-allowed" : "pointer",
                opacity: isSending || !agentMessage.trim() ? 0.7 : 1,
              }}
            >
              {isSending ? "Sending..." : "Send"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
