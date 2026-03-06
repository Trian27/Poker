import React from 'react';
import { useNavigate } from 'react-router-dom';
import './TutorialPage.css';

export const TutorialPage: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="tutorial-page">
      <div className="tutorial-card">
        <h1>TUTORIAL TO COME</h1>
        <p>The guided onboarding table walkthrough will be added here.</p>
        <button type="button" onClick={() => navigate('/dashboard', { replace: true })}>
          Close
        </button>
      </div>
    </div>
  );
};
