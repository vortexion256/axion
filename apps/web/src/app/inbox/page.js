"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { db } from "../../lib/firebase";
import { useAuth } from "../../lib/auth-context";
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  doc,
  updateDoc,
  deleteDoc,
  getDocs,
  where,
  limit,
} from "firebase/firestore";

export default function InboxPage() {
  const { user, company, loading } = useAuth();
  const router = useRouter();
  const [conversations, setConversations] = useState([]);
  const [selectedConv, setSelectedConv] = useState(null);
  const [messages, setMessages] = useState([]);
  const [agentMessage, setAgentMessage] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isTogglingAI, setIsTogglingAI] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  const tenantId = company?.id;

  useEffect(() => {
    if (!tenantId) return;

    const convRef = collection(db, "companies", tenantId, "conversations");
    const q = query(convRef, orderBy("lastUpdated", "desc"));

    const unsubscribe = onSnapshot(q, async (snapshot) => {
      const conversationsWithErrors = await Promise.all(
        snapshot.docs.map(async (doc) => {
          const convData = { id: doc.id, ...doc.data() };

          // Check if this conversation has any error messages
          const messagesRef = collection(db, "companies", tenantId, "conversations", doc.id, "messages");
          const errorQuery = query(messagesRef, where("error", "==", true), limit(1));
          const errorSnapshot = await getDocs(errorQuery);

          convData.hasErrors = !errorSnapshot.empty;
          return convData;
        })
      );

      setConversations(conversationsWithErrors);
    });

    return () => unsubscribe();
  }, [tenantId]);

  useEffect(() => {
    if (!selectedConv || !tenantId) return;

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
  }, [selectedConv, tenantId]);

  const apiBase =
    process.env.NEXT_PUBLIC_API_BASE_URL || "https://ellen-nonabridgable-samual.ngrok-free.dev";

  console.log("API Base URL:", apiBase);
  console.log("NEXT_PUBLIC_API_BASE_URL:", process.env.NEXT_PUBLIC_API_BASE_URL);

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
          tenantId, // Pass tenant ID to API
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
      console.log("Sending to API:", `${apiBase}/agent/send-message`);
      console.log("Request data:", {
        convId: selectedConv.id,
        body: agentMessage.trim(),
        tenantId
      });

      const resp = await fetch(`${apiBase}/agent/send-message`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          convId: selectedConv.id,
          body: agentMessage.trim(),
          tenantId, // Pass tenant ID to API
        }),
      });

      console.log("Response status:", resp.status);

      if (!resp.ok) {
        const errText = await resp.text();
        console.error("Error sending agent message:", errText);
        console.error("Response status:", resp.status);
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

  async function handleDeleteConversation() {
    if (!selectedConv) return;

    if (!confirm(`Are you sure you want to delete this conversation with ${selectedConv.participants?.[0] || 'Unknown'}? This action cannot be undone.`)) {
      return;
    }

    try {
      setIsDeleting(true);

      // Delete all messages in the conversation
      const messagesRef = collection(db, "companies", tenantId, "conversations", selectedConv.id, "messages");
      const messagesSnap = await getDocs(messagesRef);

      const deletePromises = messagesSnap.docs.map(doc => deleteDoc(doc.ref));
      await Promise.all(deletePromises);

      // Delete the conversation document
      const convRef = doc(db, "companies", tenantId, "conversations", selectedConv.id);
      await deleteDoc(convRef);

      setSelectedConv(null);
      setMessages([]);
      alert("Conversation deleted successfully.");

    } catch (err) {
      console.error("Error deleting conversation:", err);
      alert("Failed to delete conversation. Check console for details.");
    } finally {
      setIsDeleting(false);
    }
  }

  if (loading || !company) {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh',
        fontSize: '18px'
      }}>
        Loading...
      </div>
    );
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
                border: conv.hasErrors ? "2px solid #f44336" : "1px solid transparent",
              }}
              onClick={() => setSelectedConv(conv)}
            >
              <div style={{ fontWeight: 500, display: "flex", alignItems: "center", gap: "0.5rem" }}>
                {conv.participants?.[0] || "Unknown"}
                {conv.hasErrors && (
                  <span style={{ color: "#f44336", fontSize: "0.8rem" }}>⚠️</span>
                )}
              </div>
              <div style={{ fontSize: "0.75rem", color: "#666" }}>
                {conv.lastUpdated
                  ? new Date(conv.lastUpdated.seconds * 1000).toLocaleString()
                  : ""}
                {conv.hasErrors && (
                  <span style={{ color: "#f44336", marginLeft: "0.5rem" }}>
                    (Delivery Error)
                  </span>
                )}
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
            <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.5rem" }}>
              <div style={{ fontSize: "0.85rem" }}>
                <strong>AI status:</strong>{" "}
                {selectedConv.aiEnabled === false ? "Off" : "On"}
              </div>
              <button
                onClick={handleToggleAI}
                disabled={isTogglingAI}
                style={{
                  padding: "0.25rem 0.5rem",
                  fontSize: "0.75rem",
                  borderRadius: "3px",
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

            <button
              onClick={handleDeleteConversation}
              disabled={isDeleting}
              style={{
                padding: "0.25rem 0.5rem",
                fontSize: "0.75rem",
                borderRadius: "3px",
                border: "1px solid #f44336",
                backgroundColor: "#ffeaea",
                color: "#f44336",
                cursor: isDeleting ? "default" : "pointer",
              }}
            >
              {isDeleting ? "Deleting..." : "🗑️ Delete Conversation"}
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
              <div key={msg.id} style={{
                marginBottom: "0.5rem",
                padding: msg.error ? "0.75rem" : "0.25rem",
                borderRadius: "4px",
                backgroundColor: msg.error ? "#ffeaea" : "transparent",
                border: msg.error ? "1px solid #f44336" : "none",
                color: msg.error ? "#d32f2f" : "inherit"
              }}>
                <strong style={{ color: msg.from === "System" ? "#ff9800" : "inherit" }}>
                  {msg.from}
                </strong>:{" "}
                {msg.body || JSON.stringify(msg.payload)}
                {msg.errorCode && (
                  <div style={{ fontSize: "0.75rem", marginTop: "0.25rem", color: "#666" }}>
                    Error Code: {msg.errorCode}
                  </div>
                )}
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
