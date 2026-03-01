import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { feedbackApi } from '../api';
import { useAuth } from '../auth-context';
import type { FeedbackComplaintBucket, FeedbackReport } from '../types';
import './FeatureHub.css';
import { getApiErrorMessage } from '../utils/error';

export const FeedbackPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [feedbackType, setFeedbackType] = useState<'bug' | 'feedback'>('bug');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const [reports, setReports] = useState<FeedbackReport[]>([]);
  const [buckets, setBuckets] = useState<FeedbackComplaintBucket[]>([]);

  const isAdmin = Boolean(user?.is_admin);

  const loadAdminData = useCallback(async () => {
    if (!isAdmin) {
      return;
    }
    try {
      const [allReports, complaintBuckets] = await Promise.all([
        feedbackApi.listAsAdmin(),
        feedbackApi.complaintBucketsAsAdmin(),
      ]);
      setReports(allReports);
      setBuckets(complaintBuckets);
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to load admin feedback view'));
    }
  }, [isAdmin]);

  useEffect(() => {
    loadAdminData();
  }, [loadAdminData]);

  const submitFeedback = async () => {
    try {
      await feedbackApi.submit({
        feedback_type: feedbackType,
        title,
        description,
        context: {
          user_agent: navigator.userAgent,
          url: window.location.href,
          submitted_at: new Date().toISOString(),
        },
      });
      setTitle('');
      setDescription('');
      setMessage('Thanks, your report was submitted.');
      await loadAdminData();
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to submit feedback'));
    }
  };

  return (
    <div className="feature-page">
      <div className="feature-header">
        <h1>Feedback & Bug Portal</h1>
        <button className="secondary" onClick={() => navigate('/dashboard')}>Back</button>
      </div>

      {error && <div className="feature-card">{error}</div>}
      {message && <div className="feature-card">{message}</div>}

      <div className="feature-grid">
        <div className="feature-card">
          <h3>Submit a Report</h3>
          <select value={feedbackType} onChange={(event) => setFeedbackType(event.target.value as 'bug' | 'feedback')}>
            <option value="bug">Bug</option>
            <option value="feedback">Feedback</option>
          </select>
          <input
            style={{ marginTop: 8 }}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Short title"
          />
          <textarea
            style={{ marginTop: 8 }}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={8}
            placeholder="Describe the issue/feedback in detail"
          />
          <button type="button" style={{ marginTop: 8 }} onClick={submitFeedback}>
            Submit
          </button>
        </div>

        {user?.is_admin && (
          <>
            <div className="feature-card">
              <h3>Top Complaint Buckets</h3>
              <div className="feature-list">
                {buckets.map((bucket) => (
                  <div key={bucket.chief_complaint} className="feature-meta">
                    {bucket.chief_complaint}: {bucket.count}
                  </div>
                ))}
                {buckets.length === 0 && <div className="feature-meta">No reports yet.</div>}
              </div>
            </div>

            <div className="feature-card" style={{ gridColumn: '1 / -1' }}>
              <h3>Recent Reports</h3>
              <div className="feature-list">
                {reports.map((report) => (
                  <div key={report.id} className="feature-card">
                    <h3>#{report.id} {report.feedback_type.toUpperCase()} - {report.title}</h3>
                    <div className="feature-meta">Complaint bucket: {report.chief_complaint}</div>
                    <p>{report.description}</p>
                  </div>
                ))}
                {reports.length === 0 && <div className="feature-meta">No reports yet.</div>}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
