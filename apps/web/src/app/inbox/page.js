"use client";

import { useEffect, useState } from "react";
import { db } from "../../lib/firebase"; // path relative to src/app/inbox
import {
  collection,
  query,
  orderBy,
  onSnapshot,
} from "firebase/firestore";

export default function InboxPage() {
  const [conversations, setConversations] = useState([]);
  const [selectedConv, setSelectedConv] = useState(null);
  const [messages, setMessages] = useState([]);

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

  return (
    <div style={{ display: "flex", height: "100vh" }}>
      <div style={{ width: "300px", borderRight: "1px solid #ccc", padding: "1rem" }}>
        <h2>Conversations</h2>
        {conversations.map((conv) => (
          <div
            key={conv.id}
            style={{
              padding: "0.5rem",
              cursor: "pointer",
              backgroundColor: selectedConv?.id === conv.id ? "#e0f7fa" : "",
            }}
            onClick={() => setSelectedConv(conv)}
          >
            {conv.participants?.[0] || "Unknown"}{" "}
            <span style={{ fontSize: "0.8rem", color: "#666" }}>
              {conv.lastUpdated
                ? new Date(conv.lastUpdated.seconds * 1000).toLocaleString()
                : ""}
            </span>
          </div>
        ))}
      </div>

      <div style={{ flex: 1, padding: "1rem", overflowY: "auto" }}>
        <h2>Messages</h2>
        {selectedConv ? (
          messages.map((msg) => (
            <div key={msg.id} style={{ marginBottom: "0.5rem" }}>
              <strong>{msg.from}</strong>: {msg.body || JSON.stringify(msg.payload)}
            </div>
          ))
        ) : (
          <p>Select a conversation</p>
        )}
      </div>
    </div>
  );
}
