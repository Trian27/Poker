import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { messagesApi, usersApi } from '../api';
import type { DirectConversation, DirectMessage } from '../types';
import { useAuth } from '../auth-context';
import './FeatureHub.css';
import { getApiErrorMessage } from '../utils/error';

interface UserSearchResult {
  id: number;
  username: string;
}

export const MessagesPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [conversations, setConversations] = useState<DirectConversation[]>([]);
  const [selectedUser, setSelectedUser] = useState<UserSearchResult | null>(null);
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<UserSearchResult[]>([]);
  const [outgoing, setOutgoing] = useState('');
  const [error, setError] = useState('');
  const selectedUserId = selectedUser?.id ?? null;

  const loadConversations = useCallback(async () => {
    try {
      const data = await messagesApi.getConversations();
      setConversations(data);
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to load conversations'));
    }
  }, []);

  const loadThread = useCallback(async (otherUserId: number) => {
    try {
      const data = await messagesApi.getThread(otherUserId);
      setMessages(data);
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to load messages'));
    }
  }, []);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    if (selectedUserId === null) {
      return;
    }

    loadThread(selectedUserId);
    const intervalId = window.setInterval(() => {
      loadThread(selectedUserId);
      loadConversations();
    }, 4000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [selectedUserId, loadThread, loadConversations]);

  const handleSearch = async () => {
    if (search.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    try {
      const data = await usersApi.search(search.trim());
      setSearchResults(data);
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to search users'));
    }
  };

  const sendMessage = async () => {
    if (!selectedUser || !outgoing.trim()) {
      return;
    }
    try {
      await messagesApi.send(selectedUser.id, outgoing.trim());
      setOutgoing('');
      await loadThread(selectedUser.id);
      await loadConversations();
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to send message'));
    }
  };

  return (
    <div className="feature-page">
      <div className="feature-header">
        <h1>Direct Messages</h1>
        <button className="secondary" onClick={() => navigate('/dashboard')}>Back</button>
      </div>

      {error && <div className="feature-card">{error}</div>}

      <div className="feature-grid">
        <div className="feature-card">
          <h3>Find Player</h3>
          <div className="feature-row">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search username"
            />
            <button type="button" onClick={handleSearch}>Search</button>
          </div>
          <div className="feature-list" style={{ marginTop: 10 }}>
            {searchResults.map((candidate) => (
              <button
                key={candidate.id}
                className="secondary"
                onClick={() => setSelectedUser(candidate)}
                type="button"
              >
                {candidate.username}
              </button>
            ))}
          </div>
        </div>

        <div className="feature-card">
          <h3>Conversations</h3>
          <div className="feature-list">
            {conversations.length === 0 && <div className="feature-meta">No conversations yet.</div>}
            {conversations.map((conversation) => (
              <button
                key={conversation.user_id}
                className="secondary"
                type="button"
                onClick={() => setSelectedUser({ id: conversation.user_id, username: conversation.username })}
              >
                {conversation.username} ({conversation.unread_count} unread)
              </button>
            ))}
          </div>
        </div>

        <div className="feature-card" style={{ gridColumn: '1 / -1' }}>
          <h3>{selectedUser ? `Chat with ${selectedUser.username}` : 'Select a conversation'}</h3>
          {selectedUser && (
            <>
              <div className="msg-thread">
                {messages.map((message) => {
                  const mine = message.sender_user_id === user?.id;
                  return (
                    <div key={message.id} className={`msg-bubble ${mine ? 'mine' : ''}`}>
                      <div>{message.content}</div>
                      <div className="feature-meta">{new Date(message.created_at).toLocaleString()}</div>
                    </div>
                  );
                })}
              </div>
              <div className="feature-row" style={{ marginTop: 10 }}>
                <input
                  value={outgoing}
                  onChange={(event) => setOutgoing(event.target.value)}
                  placeholder="Type a direct message"
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      sendMessage();
                    }
                  }}
                />
                <button type="button" onClick={sendMessage}>Send</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
