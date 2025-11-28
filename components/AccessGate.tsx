import React from 'react';

interface AccessGateProps {
  children: React.ReactNode;
}

// Coding Guideline: Do not generate UI for API key. Assume pre-configured.
const AccessGate: React.FC<AccessGateProps> = ({ children }) => {
  return <>{children}</>;
};

export default AccessGate;