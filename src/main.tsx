import React from 'react';
import ReactDOM from 'react-dom/client';
import { DAppKitProvider } from '@mysten/dapp-kit-react';
import { dAppKit } from './suiClient';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <DAppKitProvider dAppKit={dAppKit}>
      <App />
    </DAppKitProvider>
  </React.StrictMode>
);
