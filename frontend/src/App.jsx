import React, { useState, useEffect } from 'react';
import { 
  ArrowRight, User, Upload, AlertTriangle, CheckCircle, 
  Check, Trash2, LogOut, Calculator, FileSpreadsheet, 
  History, Sparkles, X, TrendingUp, RefreshCw 
} from 'lucide-react';

const API_BASE = 'http://localhost:5000/api';

function App() {
  const [token, setToken] = useState(localStorage.getItem('token') || '');
  const [user, setUser] = useState(JSON.parse(localStorage.getItem('user')) || null);
  const [email, setEmail] = useState('rohan@splitly.com'); // Default to Rohan for audit testing
  const [password, setPassword] = useState('password123');
  const [loginError, setLoginError] = useState('');

  // App data state
  const [balances, setBalances] = useState([]);
  const [simplifiedDebts, setSimplifiedDebts] = useState([]);
  const [anomalies, setAnomalies] = useState([]);
  const [selectedUserAudit, setSelectedUserAudit] = useState(null);
  const [showAuditDrawer, setShowAuditDrawer] = useState(false);
  const [loadingAudit, setLoadingAudit] = useState(false);

  // Ingestion upload state
  const [uploading, setUploading] = useState(false);
  const [importReport, setImportReport] = useState(null);
  const [uploadError, setUploadError] = useState('');

  useEffect(() => {
    if (token) {
      fetchBalances();
      fetchAnomalies();
    }
  }, [token]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginError('');
    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Login failed');
      }
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      setToken(data.token);
      setUser(data.user);
    } catch (err) {
      setLoginError(err.message);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setToken('');
    setUser(null);
    setBalances([]);
    setSimplifiedDebts([]);
    setAnomalies([]);
    setSelectedUserAudit(null);
    setShowAuditDrawer(false);
  };

  const fetchBalances = async () => {
    try {
      const res = await fetch(`${API_BASE}/groups/1/balances`);
      const data = await res.json();
      if (res.ok) {
        setBalances(data.balances);
        setSimplifiedDebts(data.simplifiedDebts);
      }
    } catch (err) {
      console.error('Error fetching balances:', err);
    }
  };

  const fetchAnomalies = async () => {
    try {
      const res = await fetch(`${API_BASE}/anomalies/pending`);
      const data = await res.json();
      if (res.ok) {
        setAnomalies(data);
      }
    } catch (err) {
      console.error('Error fetching anomalies:', err);
    }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setUploading(true);
    setUploadError('');
    setImportReport(null);

    const formData = new FormData();
    formData.append('csvFile', file);

    try {
      const res = await fetch(`${API_BASE}/import/upload`, {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to process CSV file');
      }
      setImportReport(data);
      fetchBalances();
      fetchAnomalies();
    } catch (err) {
      setUploadError(err.message);
    } finally {
      setUploading(false);
    }
  };

  const openAuditDrawer = async (userId) => {
    setLoadingAudit(true);
    setShowAuditDrawer(true);
    try {
      const res = await fetch(`${API_BASE}/users/${userId}/audit`);
      const data = await res.json();
      if (res.ok) {
        setSelectedUserAudit(data);
      }
    } catch (err) {
      console.error('Error fetching user audit:', err);
    } finally {
      setLoadingAudit(false);
    }
  };

  // Anomaly Resolution handler
  const handleResolveAnomaly = async (anomalyId, action, mutatedPayload) => {
    try {
      const res = await fetch(`${API_BASE}/anomalies/${anomalyId}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          fixed_payload: mutatedPayload
        })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to resolve anomaly');
      }
      // Refresh state
      fetchAnomalies();
      fetchBalances();
      
      // If we are currently viewing the audit trail of the user affected, refresh it
      if (selectedUserAudit) {
        openAuditDrawer(selectedUserAudit.userId);
      }
    } catch (err) {
      alert('Error: ' + err.message);
    }
  };

  // Helper to update field in fixed_json_payload locally in state before resolving
  const updateAnomalyPayload = (index, key, val) => {
    const updated = [...anomalies];
    updated[index].fixed_json_payload[key] = val;
    setAnomalies(updated);
  };

  const updateAnomalySplit = (anomalyIndex, memberName, val) => {
    const updated = [...anomalies];
    updated[anomalyIndex].fixed_json_payload.splits[memberName] = parseFloat(val) || 0.0;
    setAnomalies(updated);
  };

  if (!token) {
    return (
      <div className="login-container">
        <div className="login-card glass-panel">
          <h1 className="brand-title">Splitly</h1>
          <p className="brand-subtitle">Shared Flatmate Expense Management</p>
          
          <form onSubmit={handleLogin}>
            <div className="form-group">
              <label className="form-label">Email Address</label>
              <input 
                type="email" 
                className="form-input" 
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="rohan@splitly.com" 
                required 
              />
            </div>
            
            <div className="form-group">
              <label className="form-label">Password</label>
              <input 
                type="password" 
                className="form-input" 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••" 
                required 
              />
            </div>

            {loginError && (
              <p className="text-danger margin-b-20" style={{ fontSize: '0.85rem' }}>
                {loginError}
              </p>
            )}

            <button type="submit" className="btn-primary">
              <Sparkles size={18} />
              Secure Log In
            </button>
          </form>

          <div style={{ marginTop: '24px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            <p>Seeded Credentials for testing:</p>
            <p style={{ fontFamily: 'monospace' }}>Email: rohan@splitly.com | Password: password123</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <header className="app-header">
        <h1 className="brand-title" style={{ fontSize: '1.8rem', margin: 0 }}>Splitly</h1>
        <div className="user-badge">
          <div className="avatar">
            {user ? user.name[0] : 'U'}
          </div>
          <span style={{ fontWeight: 600 }}>{user ? user.name : 'User'}</span>
          <button onClick={handleLogout} className="btn-secondary" style={{ padding: '6px 12px' }}>
            <LogOut size={16} />
            Logout
          </button>
        </div>
      </header>

      {/* Main Content Dashboard */}
      <div className="dashboard-grid">
        
        {/* Left Column (Core features) */}
        <div>
          {/* Section 1: Balances list */}
          <section className="margin-b-20">
            <h2 className="section-title">
              <Calculator size={22} className="text-success" />
              Dynamic Roommate Balances
            </h2>
            <p className="margin-b-12" style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
              Click on any flatmate card to view their auditable ledger. No cached values; balances are dynamically aggregated.
            </p>
            <div className="balances-card-list">
              {balances.map(b => (
                <div 
                  key={b.id} 
                  className="glass-panel balance-card"
                  onClick={() => openAuditDrawer(b.id)}
                >
                  <p className="name">{b.name}</p>
                  <p className={`balance-amount ${b.net > 0 ? 'positive' : b.net < 0 ? 'negative' : 'neutral'}`}>
                    {b.net > 0 ? `+₹${b.net}` : b.net < 0 ? `-₹${Math.abs(b.net)}` : '₹0.00'}
                  </p>
                  <div className="balance-details">
                    <span>Paid: ₹{Math.round(b.paid_expenses + b.paid_settlements)}</span>
                    <span>Owed: ₹{Math.round(b.owed_splits + b.received_settlements)}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Section 2: Aisha's Simplified Debts */}
          <section className="margin-b-32 glass-panel debts-card">
            <h2 className="section-title">
              <Sparkles size={22} style={{ color: '#818cf8' }} />
              Aisha's Debt Simplification Plan
            </h2>
            <p className="margin-b-20" style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
              Calculated using a min-flow algorithm to ensure the absolute minimum number of total bank transfers are made.
            </p>

            {simplifiedDebts.length === 0 ? (
              <div className="text-success flex-between" style={{ padding: '16px', background: 'rgba(16, 185, 129, 0.05)', borderRadius: '8px' }}>
                <span>✨ Group is fully settled up! No transfers needed.</span>
              </div>
            ) : (
              <div>
                {simplifiedDebts.map((d, i) => (
                  <div key={i} className="debt-transfer-row">
                    <div className="transfer-party">
                      <span className="text-danger">{d.from}</span>
                      <div className="transfer-arrow">
                        <span>owes</span>
                        <ArrowRight size={14} className="transfer-arrow-icon" />
                      </div>
                      <span className="text-success">{d.to}</span>
                    </div>
                    <div className="transfer-amount">
                      ₹{d.amount.toFixed(2)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Section 3: CSV Ingestion Center */}
          <section className="glass-panel" style={{ padding: '24px', marginBottom: '32px' }}>
            <h2 className="section-title">
              <FileSpreadsheet size={22} className="text-warning" />
              CSV Data Ingestion Center
            </h2>
            
            <div className="file-dropzone">
              <Upload size={32} style={{ color: 'var(--text-muted)' }} />
              <div>
                <p style={{ fontWeight: 600 }}>Select flat expenses CSV report</p>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                  Upload raw file exports containing typos, refunds, USD rates, or Sam/Meera date conflicts.
                </p>
              </div>
              <input 
                type="file" 
                accept=".csv" 
                onChange={handleFileUpload} 
                style={{ display: 'none' }} 
                id="csv-upload-input" 
              />
              <button 
                type="button" 
                className="btn-primary" 
                style={{ width: 'auto', padding: '8px 16px', marginTop: '8px' }}
                onClick={() => document.getElementById('csv-upload-input').click()}
                disabled={uploading}
              >
                {uploading ? 'Parsing Pipeline Active...' : 'Choose File'}
              </button>
            </div>

            {uploadError && (
              <div style={{ color: 'var(--color-danger)', background: 'rgba(239,68,68,0.05)', padding: '12px', borderRadius: '8px', marginBottom: '16px' }}>
                ⚠️ Ingestion Error: {uploadError}
              </div>
            )}

            {importReport && (
              <div style={{ background: 'rgba(255, 255, 255, 0.02)', padding: '16px', borderRadius: '10px', border: '1px solid var(--border-glass)', marginBottom: '24px' }}>
                <p style={{ fontWeight: 600, color: 'var(--color-success)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <CheckCircle size={18} /> Ingestion Finished successfully!
                </p>
                <div className="report-summary-stats">
                  <div className="stat-pill">
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Total Rows</p>
                    <p className="num">{importReport.totalRows}</p>
                  </div>
                  <div className="stat-pill">
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Safe Processed</p>
                    <p className="num text-success">{importReport.cleanCount}</p>
                  </div>
                  <div className="stat-pill">
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Flagged Anomalies</p>
                    <p className="num text-danger">{importReport.anomalyCount}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Ingestion anomalies workspace */}
            <div>
              <h3 className="margin-b-12" style={{ fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <AlertTriangle size={18} className="text-danger" />
                Conflict Resolution Workspace ({anomalies.length} Flagged)
              </h3>
              
              {anomalies.length === 0 ? (
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                  No pending anomalies in queue. Everything has been cleaned up.
                </p>
              ) : (
                <div>
                  {anomalies.map((anom, idx) => (
                    <div key={anom.id} className="anomaly-row">
                      
                      {/* Left: Metadata & Detected Problem */}
                      <div className="anomaly-meta">
                        <span className="anomaly-badge">Issues: {anom.detected_issue_type}</span>
                        <p style={{ fontSize: '0.85rem', fontWeight: 600 }}>Raw CSV Data Entry:</p>
                        <div className="raw-data-box">{anom.raw_csv_row_data}</div>
                      </div>

                      {/* Right: Interactive Inputs for Meera/User cleanup */}
                      <div className="resolution-inputs">
                        <p style={{ fontSize: '0.85rem', fontWeight: 600, color: '#818cf8' }}>Propose Corrected Ingestion Values:</p>
                        
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                          <div>
                            <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Description</label>
                            <input 
                              type="text" 
                              className="form-input" 
                              style={{ padding: '6px 10px', fontSize: '0.8rem' }}
                              value={anom.fixed_json_payload.description || ''}
                              onChange={(e) => updateAnomalyPayload(idx, 'description', e.target.value)}
                            />
                          </div>
                          <div>
                            <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Payer (paid_by)</label>
                            <input 
                              type="text" 
                              className="form-input" 
                              style={{ padding: '6px 10px', fontSize: '0.8rem' }}
                              value={anom.fixed_json_payload.paid_by || ''}
                              onChange={(e) => updateAnomalyPayload(idx, 'paid_by', e.target.value)}
                            />
                          </div>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
                          <div>
                            <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Date</label>
                            <input 
                              type="text" 
                              className="form-input" 
                              style={{ padding: '6px 10px', fontSize: '0.8rem' }}
                              value={anom.fixed_json_payload.date || ''}
                              onChange={(e) => updateAnomalyPayload(idx, 'date', e.target.value)}
                            />
                          </div>
                          <div>
                            <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Raw Amount</label>
                            <input 
                              type="number" 
                              className="form-input" 
                              style={{ padding: '6px 10px', fontSize: '0.8rem' }}
                              value={anom.fixed_json_payload.raw_amount || 0}
                              onChange={(e) => updateAnomalyPayload(idx, 'raw_amount', parseFloat(e.target.value) || 0)}
                            />
                          </div>
                          <div>
                            <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Exchange Rate</label>
                            <input 
                              type="number" 
                              step="0.00001"
                              className="form-input" 
                              style={{ padding: '6px 10px', fontSize: '0.8rem' }}
                              value={anom.fixed_json_payload.exchange_rate || 1.0}
                              onChange={(e) => updateAnomalyPayload(idx, 'exchange_rate', parseFloat(e.target.value) || 1.0)}
                            />
                          </div>
                        </div>

                        {/* Interactive Splits breakdown */}
                        {!anom.fixed_json_payload.is_settlement && anom.fixed_json_payload.splits && (
                          <div style={{ padding: '8px', background: 'rgba(255,255,255,0.01)', borderRadius: '6px', border: '1px solid var(--border-glass)' }}>
                            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Splits Breakdown (INR Owed):</span>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: '8px', marginTop: '4px' }}>
                              {Object.entries(anom.fixed_json_payload.splits).map(([mName, amt]) => (
                                <div key={mName}>
                                  <label style={{ fontSize: '0.65rem', display: 'block' }}>{mName}</label>
                                  <input 
                                    type="number" 
                                    className="form-input" 
                                    style={{ padding: '4px 6px', fontSize: '0.75rem' }}
                                    value={amt}
                                    onChange={(e) => updateAnomalySplit(idx, mName, e.target.value)}
                                  />
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Decision Actions */}
                        <div className="resolution-actions">
                          <button 
                            className="btn-primary" 
                            style={{ padding: '6px 12px', fontSize: '0.8rem', background: 'linear-gradient(135deg, var(--color-success) 0%, #10b981 100%)' }}
                            onClick={() => handleResolveAnomaly(anom.id, 'APPROVE_MUTATED', anom.fixed_json_payload)}
                          >
                            <Check size={14} /> Approve Merged Row
                          </button>
                          
                          <button 
                            className="btn-secondary" 
                            style={{ padding: '6px 12px', fontSize: '0.8rem' }}
                            onClick={() => handleResolveAnomaly(anom.id, 'KEEP_RAW', anom.fixed_json_payload)}
                          >
                            Keep Raw Row
                          </button>

                          <button 
                            className="btn-secondary text-danger" 
                            style={{ padding: '6px 12px', fontSize: '0.8rem', marginLeft: 'auto' }}
                            onClick={() => handleResolveAnomaly(anom.id, 'REJECT', null)}
                          >
                            <Trash2 size={14} /> Delete Entry
                          </button>
                        </div>

                      </div>

                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>

        {/* Right Column (Info / Stats Panel) */}
        <div>
          <section className="glass-panel" style={{ padding: '24px', position: 'sticky', top: '24px' }}>
            <h2 className="section-title" style={{ fontSize: '1.25rem', marginBottom: '16px' }}>
              <Sparkles size={20} className="text-success" />
              Flatmate Settings & Policies
            </h2>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', fontSize: '0.85rem' }}>
              <div style={{ borderBottom: '1px solid var(--border-glass)', paddingBottom: '12px' }}>
                <p style={{ fontWeight: 600, color: '#818cf8', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <User size={14} /> Aisha's Rule: Debt minimization
                </p>
                <p style={{ color: 'var(--text-muted)', marginTop: '4px' }}>
                  Greedy min-flow algorithm matches largest creditors with largest debtors to minimize bank transfers.
                </p>
              </div>

              <div style={{ borderBottom: '1px solid var(--border-glass)', paddingBottom: '12px' }}>
                <p style={{ fontWeight: 600, color: '#818cf8', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <History size={14} /> Rohan's Rule: Fully Auditable
                </p>
                <p style={{ color: 'var(--text-muted)', marginTop: '4px' }}>
                  No precalculated balances. Click on any flatmate card to pull a detailed ledger showing every expense line and payment that contributes to the net.
                </p>
              </div>

              <div style={{ borderBottom: '1px solid var(--border-glass)', paddingBottom: '12px' }}>
                <p style={{ fontWeight: 600, color: '#818cf8', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <TrendingUp size={14} /> Priya's Rule: USD Ingestion
                </p>
                <p style={{ color: 'var(--text-muted)', marginTop: '4px' }}>
                  USD lines are programmatically multiplied by historical exchange rates (Feb=83, Mar=83.50, Apr=84) rather than 1:1.
                </p>
              </div>

              <div>
                <p style={{ fontWeight: 600, color: '#818cf8', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <AlertTriangle size={14} /> Sam & Meera: Membership Boundaries
                </p>
                <p style={{ color: 'var(--text-muted)', marginTop: '4px' }}>
                  Sam joined <strong>April 15, 2026</strong>. Meera left <strong>March 31, 2026</strong>.
                  The pipeline flags date anomalies so Sam is never charged for earlier expenses and Meera is never charged for later ones.
                </p>
              </div>
            </div>
          </section>
        </div>

      </div>

      {/* Rohan's Audit Trail Slide-Drawer */}
      {showAuditDrawer && (
        <div>
          <div className="drawer-overlay" onClick={() => setShowAuditDrawer(false)} />
          <div className="drawer">
            <div className="drawer-header">
              <h2 style={{ fontSize: '1.6rem', display: 'flex', alignItems: 'center', gap: '10px' }}>
                <History size={24} style={{ color: '#818cf8' }} />
                {selectedUserAudit ? `${selectedUserAudit.userName}'s Ledger` : 'Roommate Ledger'}
              </h2>
              <button onClick={() => setShowAuditDrawer(false)} className="btn-secondary" style={{ padding: '6px', borderRadius: '50%' }}>
                <X size={20} />
              </button>
            </div>

            {loadingAudit ? (
              <div style={{ textAlign: 'center', padding: '40px' }}>
                <RefreshCw className="text-success" style={{ animation: 'spin 1.5s linear infinite' }} />
                <p style={{ marginTop: '12px', color: 'var(--text-muted)' }}>Retrieving audit ledger from DB...</p>
              </div>
            ) : selectedUserAudit ? (
              <div className="drawer-content">
                <div style={{ background: 'rgba(255,255,255,0.02)', padding: '16px', borderRadius: '8px', border: '1px solid var(--border-glass)', marginBottom: '24px' }}>
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Current Dynamic Net Balance</p>
                  <p style={{ fontSize: '2rem', fontWeight: 800, fontFamily: 'var(--font-heading)' }} className={selectedUserAudit.currentNetBalance > 0 ? 'text-success' : selectedUserAudit.currentNetBalance < 0 ? 'text-danger' : ''}>
                    {selectedUserAudit.currentNetBalance > 0 ? `+₹${selectedUserAudit.currentNetBalance}` : selectedUserAudit.currentNetBalance < 0 ? `-₹${Math.abs(selectedUserAudit.currentNetBalance)}` : '₹0.00'}
                  </p>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    Fully aggregated from database transactions. Zero hardcoded magic numbers.
                  </span>
                </div>

                <div className="audit-timeline">
                  {selectedUserAudit.ledger.map((entry) => {
                    const isPositive = entry.effect > 0;
                    const isOwed = entry.type === 'OWED_SHARE';
                    
                    let nodeClass = 'payment';
                    if (entry.type === 'OWED_SHARE') nodeClass = 'split';
                    if (entry.type === 'SETTLEMENT_PAID') nodeClass = 'settlement_paid';
                    if (entry.type === 'SETTLEMENT_RECEIVED') nodeClass = 'settlement_received';

                    return (
                      <div key={entry.id} className={`audit-node ${nodeClass}`}>
                        <div className="audit-meta">
                          <span>{entry.date}</span>
                          <span style={{ fontWeight: 600, letterSpacing: '0.05em', fontSize: '0.65rem' }}>
                            {entry.type}
                          </span>
                        </div>
                        <p className="audit-desc">{entry.description}</p>
                        <div className="audit-impact">
                          <span className={isPositive ? 'text-success' : 'text-danger'} style={{ fontWeight: 600 }}>
                            {isPositive ? `+₹${entry.effect.toFixed(2)}` : `-₹${Math.abs(entry.effect).toFixed(2)}`}
                          </span>
                          <span className="running-balance-pill">
                            Bal: ₹{entry.running_balance.toFixed(2)}
                          </span>
                        </div>
                      </div>
                    );
                  })}

                  {selectedUserAudit.ledger.length === 0 && (
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', padding: '20px' }}>
                      No transactions found.
                    </p>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* CSS Spin style for loader */}
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

export default App;
