import React, { useState, useEffect, useRef } from 'react';
import { Icon } from '../components/Icon';
import { BrandLogo } from '../components/BrandLogo';
import { ThemeToggle } from '../components/ThemeToggle';
import { apiLogin, apiSignup, apiForgotPassword, apiResendEmailOtp, apiVerifyEmailOtp, AuthUser } from '../lib/api';
import '../styles/forgot-password.css';
import { useDispatch } from '../state/store';
import { getCurrentWindow } from '@tauri-apps/api/window';

interface PainPoint {
  id: number;
  tag: string;
  category: string;
  problem: string;
  solution: string;
  description: string;
  metric: string;
  icon: string;
}

const PAIN_POINTS: PainPoint[] = [
  {
    id: 1,
    tag: 'PAIN POINT 01 OF 07',
    category: 'GST Compliance & ITC Reconciliation',
    problem: 'The GSTR-2B vs Purchase Register Mismatch Nightmare',
    solution: 'AI-Powered Dual-Stream Reconciliation & Fraud Shield',
    description:
      'Cross-references thousands of purchase invoices with GSTN data in under 4 seconds. Instantly detects vendor invoice omissions, Section 17(5) blocked credits, and shields your clients from devastating Section 73 & 74 demand notices.',
    metric: '99.4% Match Accuracy • 18+ Hours Saved Monthly per Client',
    icon: 'shield',
  },
  {
    id: 2,
    tag: 'PAIN POINT 02 OF 07',
    category: 'Client Document Collection',
    problem: 'Endless WhatsApp & Email Document Chasing Chaos',
    solution: 'Secure Client Portal & Cloud Intake',
    description:
      'Clients upload sensitive tax documents through their private Orvexa portal. Originals are stored in private Supabase Storage, while structured metadata and extracted fields remain in the database for staff review.',
    metric: 'Private portal uploads • Reviewable extraction history',
    icon: 'chat',
  },
  {
    id: 3,
    tag: 'PAIN POINT 03 OF 07',
    category: 'Accounting & ERP Automation',
    problem: 'Exhausting Manual Tally Re-entry & Clerical Typing Errors',
    solution: 'Direct One-Click Tally Prime & ERP XML Voucher Pipeline',
    description:
      'Eliminates tedious manual bookkeeping. Auto-maps extracted line items to your existing chart of accounts, verifies HSN/SAC tax rates, and pushes clean XML purchase vouchers in seconds with zero data entry errors.',
    metric: '100% Tax Accuracy • 1-Click Batch Voucher Export',
    icon: 'spark',
  },
  {
    id: 4,
    tag: 'PAIN POINT 04 OF 07',
    category: 'Direct Tax & Withholding',
    problem: 'Section 194Q & 206C TDS/TCS Cumulative Turnover Slip-ups',
    solution: 'Live ₹50L Threshold Monitor & Auto Form 26Q Schedules',
    description:
      'Never miss the ₹50 Lakh cumulative purchase threshold or 0.1% deduction triggers. Orvexa AI monitors vendor turnover in real time and automatically prepares quarterly 26Q & 27EQ schedules with automated challan linking.',
    metric: '100% Threshold Compliance • Zero 201(1A) Interest Fines',
    icon: 'rupee',
  },
  {
    id: 5,
    tag: 'PAIN POINT 05 OF 07',
    category: 'Practice Workflow & Deadlines',
    problem: 'Missed Filing Deadlines & Crippling Late Fees',
    solution: 'Unified Master Compliance Kanban & Automated Escalation',
    description:
      'Track 200+ clients across GSTR-1, GSTR-3B, Advance Tax, and ROC filings on a high-visibility real-time Kanban board. Automatically dispatches polite WhatsApp nudges 7, 3, and 1 day prior to statutory cutoffs.',
    metric: 'Zero Late Filing Penalties • 100% On-Time Track Record',
    icon: 'cal',
  },
  {
    id: 6,
    tag: 'PAIN POINT 06 OF 07',
    category: 'Scrutiny & Audit Defense',
    problem: 'Scattered Audit Trails & Client Discrepancy Disputes',
    solution: 'Tamper-Evident Local Audit Logs & 1-Click Defense Dossiers',
    description:
      'Maintain an immutable, timestamped record of every client submission, invoice OCR scan, and calculation. Generates Section 148 / 142(1) scrutiny response drafts with pre-indexed documentary exhibits in 1 click.',
    metric: 'Instant Scrutiny Dossier • 100% Audit Readiness',
    icon: 'folder',
  },
  {
    id: 7,
    tag: 'PAIN POINT 07 OF 07',
    category: 'Practice Profitability & Cash Flow',
    problem: 'Unbilled Advisory Hours & Chronic Client Payment Delays',
    solution: 'Milestone-Linked Auto Invoicing & WhatsApp UPI Collect',
    description:
      'Automatically generates GST-compliant practice fee invoices the instant a return is filed. Sends automated WhatsApp reminders with dynamic UPI payment QR codes, slashing overdue receivables by 65%.',
    metric: '3x Faster Fee Realization • Automated Practice Invoicing',
    icon: 'users',
  },
];

export function AuthPage() {
  const dispatch = useDispatch();

  // Mode: Default is 'signup' as requested ("on right side it should show always first sign up tab card")
  const [authMode, setAuthMode] = useState<'signup' | 'login'>('signup');

  // Slide carousel state for left side
  const [currentSlide, setCurrentSlide] = useState(0);
  const [isPaused, setIsPaused] = useState(false);

  // Typewriter animation state
  const [typedProblem, setTypedProblem] = useState('');
  const [typedSolution, setTypedSolution] = useState('');
  const [typedDescription, setTypedDescription] = useState('');
  const [typingStage, setTypingStage] = useState<'problem' | 'solution' | 'desc' | 'waiting'>('problem');
  const [progressPercent, setProgressPercent] = useState(0);

  // Form states - Sign Up
  const [signupName, setSignupName] = useState('');
  const [signupType, setSignupType] = useState('Chartered Accountant (CA)');
  const [signupEmail, setSignupEmail] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [signupConfirm, setSignupConfirm] = useState('');
  const [signupAgree, setSignupAgree] = useState(false);
  const [signupConfirmedEmail, setSignupConfirmedEmail] = useState<string | null>(null);
  const [signupVerificationId, setSignupVerificationId] = useState('');
  const [signupOtp, setSignupOtp] = useState('');
  const [otpState, setOtpState] = useState<'idle' | 'verifying' | 'success'>('idle');
  const [otpResendSeconds, setOtpResendSeconds] = useState(0);
  const otpInputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const [showSignupPass, setShowSignupPass] = useState(false);

  // Form states - Login
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [showLoginPass, setShowLoginPass] = useState(false);

  // UI state
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [loginAccountNotFound, setLoginAccountNotFound] = useState(false);
  const [forgotModalOpen, setForgotModalOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotNotice, setForgotNotice] = useState<string | null>(null);
  const [forgotError, setForgotError] = useState<string | null>(null);
  const [forgotSending, setForgotSending] = useState(false);
  const [forgotCooldown, setForgotCooldown] = useState(0);
  const [passwordResetHandoffOpen, setPasswordResetHandoffOpen] = useState(false);

  useEffect(() => {
    if (forgotCooldown <= 0) return;
    const timer = window.setInterval(() => {
      setForgotCooldown((previous) => Math.max(0, previous - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [forgotCooldown]);

  useEffect(() => {
    const onPasswordResetComplete = () => {
      setAuthMode('login');
      setPasswordResetHandoffOpen(true);
      setErrorMessage(null);
      setSuccessMessage(null);
    };
    window.addEventListener('orvexa:password-reset-complete', onPasswordResetComplete);
    return () => window.removeEventListener('orvexa:password-reset-complete', onPasswordResetComplete);
  }, []);

  // Rate Limiting & Cooldown state
  const [lockoutSeconds, setLockoutSeconds] = useState(0);
  const failedAttemptsRef = useRef(0);

  const activePoint = PAIN_POINTS[currentSlide];

  // ─────────────────────────────────────────────────────────────
  // Typewriter Effect Logic for Left Showcase
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    let isCancelled = false;
    setTypedProblem('');
    setTypedSolution('');
    setTypedDescription('');
    setTypingStage('problem');
    setProgressPercent(0);

    const problemText = activePoint.problem;
    const solutionText = activePoint.solution;
    const descText = activePoint.description;

    let pIdx = 0;
    let sIdx = 0;
    let dIdx = 0;

    // Type problem heading
    const pTimer = setInterval(() => {
      if (isCancelled) return;
      if (pIdx < problemText.length) {
        setTypedProblem(problemText.substring(0, pIdx + 1));
        pIdx++;
      } else {
        clearInterval(pTimer);
        setTypingStage('solution');

        // Delay before solution
        setTimeout(() => {
          if (isCancelled) return;
          const sTimer = setInterval(() => {
            if (isCancelled) return;
            if (sIdx < solutionText.length) {
              setTypedSolution(solutionText.substring(0, sIdx + 1));
              sIdx++;
            } else {
              clearInterval(sTimer);
              setTypingStage('desc');

              // Delay before description
              setTimeout(() => {
                if (isCancelled) return;
                const dTimer = setInterval(() => {
                  if (isCancelled) return;
                  if (dIdx < descText.length) {
                    setTypedDescription(descText.substring(0, dIdx + 1));
                    dIdx++;
                  } else {
                    clearInterval(dTimer);
                    setTypingStage('waiting');
                  }
                }, 16);
              }, 180);
            }
          }, 24);
        }, 180);
      }
    }, 28);

    return () => {
      isCancelled = true;
      clearInterval(pTimer);
    };
  }, [currentSlide, activePoint]);

  // ─────────────────────────────────────────────────────────────
  // 4.5s Dwell Countdown Bar & Next Slide Transition
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (typingStage !== 'waiting' || isPaused) return;

    const totalDuration = 4500; // 4.5 seconds
    const intervalTime = 50;
    const step = (intervalTime / totalDuration) * 100;

    const barTimer = setInterval(() => {
      setProgressPercent((prev) => {
        if (prev >= 100) {
          clearInterval(barTimer);
          // Advance to next slide smoothly
          setCurrentSlide((cur) => (cur + 1) % PAIN_POINTS.length);
          return 0;
        }
        return prev + step;
      });
    }, intervalTime);

    return () => clearInterval(barTimer);
  }, [typingStage, isPaused]);

  // Lockout countdown timer
  useEffect(() => {
    if (lockoutSeconds <= 0) return;
    const timer = setInterval(() => {
      setLockoutSeconds((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [lockoutSeconds]);

  useEffect(() => {
    if (otpResendSeconds <= 0) return;
    const timer = setInterval(() => {
      setOtpResendSeconds((previous) => Math.max(0, previous - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [otpResendSeconds]);

  useEffect(() => {
    if (signupConfirmedEmail) focusOtpBox(0);
  }, [signupConfirmedEmail]);

  // Password strength calculation
  const getPasswordStrength = (pass: string) => {
    if (!pass) return { score: 0, label: '', color: 'transparent' };
    let score = 0;
    if (pass.length >= 6) score++;
    if (pass.length >= 9) score++;
    if (/[A-Z]/.test(pass) && /[a-z]/.test(pass)) score++;
    if (/[0-9]/.test(pass) || /[^A-Za-z0-9]/.test(pass)) score++;

    if (score <= 1) return { score: 1, label: 'Weak', color: '#F87171' };
    if (score === 2) return { score: 2, label: 'Fair', color: '#F6C453' };
    if (score === 3) return { score: 3, label: 'Good', color: '#4C8DFF' };
    return { score: 4, label: 'Strong', color: '#34D399' };
  };

  const passStrength = getPasswordStrength(signupPassword);

  // ─────────────────────────────────────────────────────────────
  // Handle Signup Submission
  // ─────────────────────────────────────────────────────────────
  const handleSignupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);
    setLoginAccountNotFound(false);

    if (!signupName.trim()) {
      setErrorMessage('Please enter your full name or partner designation.');
      return;
    }
    if (!signupEmail.trim() || !signupEmail.includes('@')) {
      setErrorMessage('Please provide a valid work/practice email address.');
      return;
    }
    if (signupPassword.length < 8) {
      setErrorMessage('Password must be at least 8 characters long.');
      return;
    }
    if (signupPassword !== signupConfirm) {
      setErrorMessage('Passwords do not match. Please re-enter.');
      return;
    }
    if (!signupAgree) {
      setErrorMessage('Please accept the Data Confidentiality and Vault Privacy terms.');
      return;
    }

    setIsLoading(true);
    try {
      const res = await apiSignup({
        name: signupName.trim(),
        email: signupEmail.trim(),
        password: signupPassword,
        practiceType: signupType,
      });

      if (res.accountCreated && res.needsEmailConfirmation && res.verificationId) {
        // The account is intentionally retained when the first OTP delivery
        // fails, so the user can recover with the resend flow.
        setSignupConfirmedEmail(res.email || signupEmail.trim().toLowerCase());
        setSignupVerificationId(res.verificationId);
        setSignupOtp('');
        setOtpState('idle');
        setOtpResendSeconds(0);
        setErrorMessage(res.message || 'Your account was created, but the verification code could not be delivered. Please resend it.');
      } else if (res.success) {
        if (res.needsEmailConfirmation && res.verificationId) {
          setSignupConfirmedEmail(res.email || signupEmail.trim().toLowerCase());
          setSignupVerificationId(res.verificationId);
          setSignupOtp('');
          setOtpState('idle');
          setOtpResendSeconds(60);
          setSuccessMessage('Account created. Your six-digit verification code is on its way.');
        } else if (res.user && res.token) {
          // Auto-confirmed — go straight in
          setSuccessMessage('Practice account created! Launching your workspace...');
          setTimeout(() => {
            dispatch({ type: 'LOGIN', user: res.user!, token: res.token!, refreshToken: res.refreshToken });
          }, 600);
        }
      } else {
        setErrorMessage(res.message || 'Signup failed. Please try again.');
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'An unexpected error occurred during signup.');
    } finally {
      setIsLoading(false);
    }
  };

  const focusOtpBox = (index: number) => {
    window.requestAnimationFrame(() => otpInputRefs.current[Math.max(0, Math.min(5, index))]?.focus());
  };

  const completeEmailVerification = async (code: string) => {
    if (code.length !== 6 || !signupVerificationId || otpState === 'verifying' || otpState === 'success') return;
    setOtpState('verifying');
    setErrorMessage(null);
    try {
      await apiVerifyEmailOtp(signupVerificationId, code);
      setOtpState('success');
      setSuccessMessage('Email confirmed. Preparing your secure practice workspace…');
      const login = await apiLogin(signupEmail.trim(), signupPassword);
      if (!login.success || !login.user || !login.token) throw new Error(login.message || 'Your account was verified, but sign-in could not be completed. Please sign in manually.');
      window.setTimeout(() => dispatch({ type: 'LOGIN', user: login.user!, token: login.token!, refreshToken: login.refreshToken }), 950);
    } catch (err: any) {
      setOtpState('idle');
      setErrorMessage(err.message || 'That code could not be verified. Please try again.');
    }
  };

  const handleOtpInput = (index: number, rawValue: string) => {
    const digits = rawValue.replace(/\D/g, '');
    if (!digits) {
      setSignupOtp((previous) => previous.slice(0, index) + previous.slice(index + 1));
      return;
    }
    const next = signupOtp.split('');
    digits.slice(0, 6 - index).split('').forEach((digit, offset) => { next[index + offset] = digit; });
    const code = next.join('').slice(0, 6);
    setSignupOtp(code);
    focusOtpBox(Math.min(index + digits.length, 5));
    if (code.length === 6) void completeEmailVerification(code);
  };

  const handleOtpKeyDown = (event: React.KeyboardEvent<HTMLInputElement>, index: number) => {
    if (event.key === 'Backspace' && !signupOtp[index] && index > 0) {
      event.preventDefault();
      const next = signupOtp.slice(0, index - 1) + signupOtp.slice(index);
      setSignupOtp(next);
      focusOtpBox(index - 1);
    }
    if (event.key === 'ArrowLeft' && index > 0) focusOtpBox(index - 1);
    if (event.key === 'ArrowRight' && index < 5) focusOtpBox(index + 1);
  };

  const resendSignupOtp = async () => {
    if (!signupVerificationId || !signupConfirmedEmail || otpResendSeconds > 0) return;
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const result = await apiResendEmailOtp(signupVerificationId, signupConfirmedEmail);
      if (result.verificationId) setSignupVerificationId(result.verificationId);
      setSignupOtp('');
      setOtpState('idle');
      setOtpResendSeconds(60);
      focusOtpBox(0);
      setSuccessMessage('A fresh verification code has been sent.');
    } catch (err: any) {
      setErrorMessage(err.message || 'A new verification code could not be sent.');
    } finally {
      setIsLoading(false);
    }
  };

  // ─────────────────────────────────────────────────────────────
  // Handle Login Submission
  // ─────────────────────────────────────────────────────────────
  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);
    setLoginAccountNotFound(false);

    if (lockoutSeconds > 0) {
      setErrorMessage(`Rate limit active. Please wait ${lockoutSeconds}s before attempting again.`);
      return;
    }

    if (!loginEmail.trim() || !loginEmail.includes('@')) {
      setErrorMessage('Please enter your registered work email.');
      return;
    }
    if (!loginPassword) {
      setErrorMessage('Please enter your account password.');
      return;
    }

    setIsLoading(true);
    try {
      const res = await apiLogin(loginEmail.trim(), loginPassword);

      if (res.success && res.user && res.token) {
        failedAttemptsRef.current = 0;
        setSuccessMessage('Credentials verified. Launching workspace...');
        setTimeout(() => {
          dispatch({ type: 'LOGIN', user: res.user!, token: res.token!, refreshToken: res.refreshToken });
        }, 500);
      } else if (res.accountNotFound) {
        // The backend confirmed this email has no registered account.
        setLoginAccountNotFound(true);
        setErrorMessage(
          `No account found for "${loginEmail.trim()}". You don't have an account yet — please sign up to get started.`
        );
      } else {
        if (res.rateLimited && res.secondsLeft) {
          setLockoutSeconds(res.secondsLeft);
          setErrorMessage(`Too many failed attempts. Security lockout active for ${res.secondsLeft} seconds.`);
        } else {
          failedAttemptsRef.current += 1;
          if (failedAttemptsRef.current >= 4) {
            setLockoutSeconds(30);
            setErrorMessage('Multiple failed attempts detected. Cooldown lock applied for 30s.');
          } else {
            setErrorMessage(res.message || 'Invalid email or password. Please try again.');
          }
        }
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Network error connecting to login service.');
    } finally {
      setIsLoading(false);
    }
  };

  // (Demo login removed — use your real Supabase account)

  // Window Controls for Tauri
  const handleMinimize = async () => {
    try {
      const appWin = getCurrentWindow();
      await appWin.minimize();
    } catch (e) {}
  };
  const handleClose = async () => {
    try {
      const appWin = getCurrentWindow();
      await appWin.close();
    } catch (e) {}
  };

  return (
    <div className="auth-root">
      {/* Top bar with drag handle and app title */}
      <header className="auth-header">
        <div className="auth-brand" data-tauri-drag-region>
          <BrandLogo className="auth-brand-logo" />
          <span className="auth-brand-chip">Enterprise CA Edition</span>
        </div>

        <div className="auth-header-right">
          <ThemeToggle showLabel={true} />
          <div className="auth-wc-divider" />
          <div className="auth-window-ctrls">
            <button className="auth-wc-btn" onClick={handleMinimize} title="Minimize">
              <svg width="11" height="11" viewBox="0 0 12 12"><path fill="currentColor" d="M1 6h10v1H1z" /></svg>
            </button>
            <button className="auth-wc-btn auth-wc-close" onClick={handleClose} title="Close">
              <svg width="11" height="11" viewBox="0 0 12 12"><path fill="currentColor" d="M2.2 1.5 6 5.3l3.8-3.8.7.7L6.7 6l3.8 3.8-.7.7L6 6.7 2.2 10.5l-.7-.7L5.3 6 1.5 2.2z" /></svg>
            </button>
          </div>
        </div>
      </header>

      {/* Main Two-Column Split Body */}
      <main className="auth-body">
        {/* ─── LEFT COLUMN: Top 7 Pain Points & AI Solutions Showcase ─── */}
        <section
          className="auth-showcase-panel"
          onMouseEnter={() => setIsPaused(true)}
          onMouseLeave={() => setIsPaused(false)}
        >
          {/* Subtle Ambient Glow Orbs */}
          <div className="auth-glow auth-glow-1" />
          <div className="auth-glow auth-glow-2" />

          <div className="auth-showcase-content">
            {/* Top Pill / Badge */}
            <div className="showcase-top-meta">
              <span className="showcase-tag-badge">
                <Icon name={activePoint.icon} size={14} />
                {activePoint.tag}
              </span>
              <span className="showcase-cat-pill">{activePoint.category}</span>
              {isPaused && <span className="showcase-paused-pill">Paused (Hover)</span>}
            </div>

            {/* Pain Point Heading with Typewriter Effect */}
            <div className="showcase-problem-block">
              <span className="showcase-section-kicker">PROBLEM SOLVED</span>
              <h2 className="showcase-heading">
                {typedProblem}
                {typingStage === 'problem' && <span className="typewriter-cursor">|</span>}
              </h2>
            </div>

            {/* AI Solution Card with Typewriter Effect */}
            <div className="showcase-solution-card">
              <div className="solution-card-header">
                <div className="solution-badge-icon">
                  <Icon name="spark" size={16} />
                </div>
                <div>
                          <span className="solution-kicker">ORVEXA AI INTELLIGENT FIX</span>
                  <h3 className="solution-title">
                    {typedSolution}
                    {typingStage === 'solution' && <span className="typewriter-cursor">|</span>}
                  </h3>
                </div>
              </div>

              <p className="solution-description">
                {typedDescription}
                {typingStage === 'desc' && <span className="typewriter-cursor">|</span>}
              </p>

              {/* Verified Impact Metric */}
              <div className="solution-metric-row">
                <span className="metric-pill">
                  <Icon name="check" size={13} />
                  {activePoint.metric}
                </span>
              </div>
            </div>

            {/* Bottom Progress Bar & Navigation Controls */}
            <div className="showcase-footer-controls">
              {/* Animated Progress Timer Bar */}
              <div className="showcase-timer-track" title="Slide timer">
                <div
                  className="showcase-timer-bar"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>

              <div className="showcase-nav-row">
                {/* 7 Interactive Slide Dots */}
                <div className="showcase-dots">
                  {PAIN_POINTS.map((p, idx) => (
                    <button
                      key={p.id}
                      className={`showcase-dot ${idx === currentSlide ? 'active' : ''}`}
                      onClick={() => setCurrentSlide(idx)}
                      title={`Jump to Pain Point 0${idx + 1}: ${p.category}`}
                    >
                      <span className="dot-inner" />
                    </button>
                  ))}
                </div>

                <div className="showcase-arrows">
                  <span className="showcase-counter">
                    0{currentSlide + 1} <i>/</i> 0{PAIN_POINTS.length}
                  </span>
                  <button
                    className="showcase-arrow-btn"
                    onClick={() => setCurrentSlide((cur) => (cur - 1 + PAIN_POINTS.length) % PAIN_POINTS.length)}
                    title="Previous pain point"
                  >
                    <svg width="14" height="14" viewBox="0 0 16 16"><path fill="currentColor" d="M10.5 3.5 6 8l4.5 4.5-.7.7L5 8l4.8-5.2z" /></svg>
                  </button>
                  <button
                    className="showcase-arrow-btn"
                    onClick={() => setCurrentSlide((cur) => (cur + 1) % PAIN_POINTS.length)}
                    title="Next pain point"
                  >
                    <svg width="14" height="14" viewBox="0 0 16 16"><path fill="currentColor" d="m5.5 3.5 4.5 4.5-4.5 4.5.7.7L11 8 6.2 2.8z" /></svg>
                  </button>
                </div>
              </div>

              {/* Compliance & Security Assurance Strip */}
              <div className="showcase-trust-strip">
                <div className="trust-item">
                  <Icon name="shield" size={13} />
                  <span>Private Cloud Document Storage</span>
                </div>
                <span className="trust-dot">•</span>
                <div className="trust-item">
                  <Icon name="lock" size={13} />
                  <span>Account-Scoped Cloud Access</span>
                </div>
                <span className="trust-dot">•</span>
                <div className="trust-item">
                  <Icon name="check" size={13} />
                  <span>ICAI Ethical Standard Ready</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ─── RIGHT COLUMN: Sliding Sign Up & Login Cards ─── */}
        <section className="auth-form-panel">
          <div className="auth-card-container">
            {/* Top Mode Segmented Pill Switcher */}
            <div className="auth-mode-switcher">
              <button
                type="button"
                className={`auth-mode-tab ${authMode === 'signup' ? 'active' : ''}`}
                onClick={() => {
                  setAuthMode('signup');
                  setErrorMessage(null);
                  setSuccessMessage(null);
                  setLoginAccountNotFound(false);
                }}
              >
                Create Account
              </button>
              <button
                type="button"
                className={`auth-mode-tab ${authMode === 'login' ? 'active' : ''}`}
                onClick={() => {
                  setAuthMode('login');
                  setErrorMessage(null);
                  setSuccessMessage(null);
                  setLoginAccountNotFound(false);
                }}
              >
                Sign In
              </button>
              <div
                className="auth-tab-slider"
                style={{
                  transform: authMode === 'signup' ? 'translateX(0%)' : 'translateX(100%)',
                }}
              />
            </div>

            {/* Error & Success Banner Alerts */}
            {errorMessage && (
              <div className="auth-alert auth-alert-error">
                <Icon name="alert" size={16} />
                <span>{errorMessage}</span>
                {loginAccountNotFound && authMode === 'login' && (
                  <button
                    type="button"
                    className="auth-alert-action-btn"
                    onClick={() => {
                      setAuthMode('signup');
                      setErrorMessage(null);
                      setLoginAccountNotFound(false);
                      setSignupEmail(loginEmail.trim());
                    }}
                    style={{
                      marginLeft: '10px',
                      background: 'var(--accent, #4C8DFF)',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '6px',
                      padding: '4px 12px',
                      fontSize: '12px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      flexShrink: 0,
                    }}
                  >
                    Sign Up →
                  </button>
                )}
              </div>
            )}
            {successMessage && !signupConfirmedEmail && (
              <div className="auth-alert auth-alert-success">
                <Icon name="check" size={16} />
                <span>{successMessage}</span>
              </div>
            )}
            {lockoutSeconds > 0 && (
              <div className="auth-alert auth-alert-warning">
                <Icon name="bell" size={16} />
                <span>Security cooldown in effect: {lockoutSeconds} seconds remaining.</span>
              </div>
            )}

            {/* Sliding Form Stage: Smooth Carousel between Signup and Login */}
            <div className="auth-slider-viewport">
              <div
                className="auth-slider-track"
                style={{
                  transform: authMode === 'signup' ? 'translateX(0%)' : 'translateX(-50%)',
                }}
              >
                {/* ────────── CARD 1: SIGN UP (Default) ────────── */}
                <div className="auth-form-card signup-card">
                  {signupConfirmedEmail ? (
                    <div className={`auth-confirmed-center otp-stage-${otpState}`}>
                      <div className="otp-success-orbit" aria-hidden="true">
                        {Array.from({ length: 6 }).map((_, index) => <span key={index} className="otp-orbit-node" />)}
                      </div>
                      <div className="confirmed-icon-aura">
                        <div className="confirmed-icon-ring" />
                        <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#34D399" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M4 4h16v16H4z" /><path d="m4 6 8 6 8-6" />
                        </svg>
                      </div>
                      <h2 className="confirmed-title">Confirm your practice email</h2>
                      <p className="confirmed-subtitle">We sent a six-digit code to</p>
                      <div className="confirmed-email-pill"><span>{signupConfirmedEmail}</span></div>
                      <div className="otp-boxes" role="group" aria-label="Six digit email verification code">
                        {Array.from({ length: 6 }).map((_, index) => {
                          const digit = signupOtp[index] || '';
                          return <input
                            key={index}
                            ref={(element) => { otpInputRefs.current[index] = element; }}
                            className={`otp-box ${digit && Number(digit) > 5 ? 'otp-digit-high' : 'otp-digit-low'}`}
                            value={digit}
                            inputMode="numeric"
                            pattern="[0-9]*"
                            maxLength={1}
                            autoComplete={index === 0 ? 'one-time-code' : 'off'}
                            aria-label={`Verification digit ${index + 1}`}
                            disabled={otpState !== 'idle'}
                            onChange={(event) => handleOtpInput(index, event.currentTarget.value)}
                            onKeyDown={(event) => handleOtpKeyDown(event, index)}
                            onPaste={(event) => {
                              event.preventDefault();
                              handleOtpInput(index, event.clipboardData.getData('text'));
                            }}
                          />;
                        })}
                      </div>
                      <div className="otp-status" aria-live="polite">
                        {otpState === 'success' ? 'Verified. Opening your workspace…' : otpState === 'verifying' ? 'Checking your code…' : 'Enter the code to confirm your account'}
                      </div>
                      <button type="button" className="confirmed-action-btn otp-resend-btn" onClick={() => void resendSignupOtp()} disabled={isLoading || otpResendSeconds > 0 || otpState !== 'idle'}>
                        {otpResendSeconds > 0 ? `Resend code in ${otpResendSeconds}s` : 'Resend verification code'}
                      </button>
                      <button type="button" className="confirmed-back-btn" onClick={() => { setSignupConfirmedEmail(null); setSignupVerificationId(''); setSignupOtp(''); setOtpState('idle'); setErrorMessage(null); }}>
                        ← Register with a different email
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="card-kicker-row">
                        <div>
                          <h1 className="card-title">Setup Practice Workspace</h1>
                          <p className="card-desc">
                            Create your personal CA workspace to activate AI document extraction and WhatsApp client sync.
                          </p>
                        </div>
                      </div>

                      <form onSubmit={handleSignupSubmit} className="auth-fields-form">
                    <div className="fields-grid-2">
                      <div className="field-group">
                        <label>Managing Partner Name *</label>
                        <div className="input-with-icon">
                          <Icon name="users" size={15} />
                          <input
                            type="text"
                            placeholder="CA Rajesh Sharma"
                            value={signupName}
                            onChange={(e) => setSignupName(e.target.value)}
                            required
                          />
                        </div>
                      </div>

                    </div>

                    <div className="field-group">
                      <label>Practice Category</label>
                      <div className="practice-pills">
                        {['Chartered Accountant (CA)', 'Individual'].map((type) => (
                          <button
                            type="button"
                            key={type}
                            className={`practice-pill ${signupType === type ? 'active' : ''}`}
                            onClick={() => setSignupType(type)}
                          >
                            {type}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="field-group">
                      <label>Practice Email Address *</label>
                      <div className="input-with-icon">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                        <input
                          type="email"
                          placeholder="rajesh@sharmatax.in"
                          value={signupEmail}
                          onChange={(e) => setSignupEmail(e.target.value)}
                          required
                        />
                      </div>
                    </div>

                    <div className="fields-grid-2">
                      <div className="field-group">
                        <label>Create Password *</label>
                        <div className="input-with-icon">
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                          <input
                            type={showSignupPass ? 'text' : 'password'}
                            placeholder="••••••••"
                            value={signupPassword}
                            onChange={(e) => setSignupPassword(e.target.value)}
                            required
                          />
                          <button
                            type="button"
                            className="input-eye-btn"
                            onClick={() => setShowSignupPass(!showSignupPass)}
                          >
                            {showSignupPass ? 'Hide' : 'Show'}
                          </button>
                        </div>
                      </div>

                      <div className="field-group">
                        <label>Confirm Password *</label>
                        <div className="input-with-icon">
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                          <input
                            type={showSignupPass ? 'text' : 'password'}
                            placeholder="••••••••"
                            value={signupConfirm}
                            onChange={(e) => setSignupConfirm(e.target.value)}
                            required
                          />
                        </div>
                      </div>
                    </div>

                    {/* Password Strength Indicator */}
                    {signupPassword && (
                      <div className="pass-strength-meter">
                        <div className="strength-bars">
                          {[1, 2, 3, 4].map((level) => (
                            <div
                              key={level}
                              className="strength-bar-seg"
                              style={{
                                backgroundColor:
                                  passStrength.score >= level ? passStrength.color : 'var(--line2)',
                              }}
                            />
                          ))}
                        </div>
                        <span className="strength-text" style={{ color: passStrength.color }}>
                          Password Strength: {passStrength.label}
                        </span>
                      </div>
                    )}

                    <div className="auth-checkbox-row">
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={signupAgree}
                          onChange={(e) => setSignupAgree(e.target.checked)}
                        />
                        <span>
                          I agree to Orvexa AI’s <a href="https://orvvexa.vercel.app/terms" target="_blank" rel="noreferrer">Terms and Conditions</a> and <a href="https://orvvexa.vercel.app/privacy" target="_blank" rel="noreferrer">Privacy Policy</a>, including private cloud document storage.
                        </span>
                      </label>
                    </div>

                    <button
                      type="submit"
                      className={`auth-primary-btn${isLoading ? ' is-loading' : ''}`}
                      disabled={isLoading}
                    >
                      {isLoading ? (
                        <span className="btn-spinner">
                          <span className="btn-spinner-icon" />
                          <span>Creating Practice Workspace</span>
                          <span className="btn-spinner-dots">
                            <span>.</span><span>.</span><span>.</span>
                          </span>
                        </span>
                      ) : (
                        <span>Create Account &amp; Launch Practice →</span>
                      )}
                    </button>
                  </form>

                  <div className="card-footer-switch">
                          <span>Already have an Orvexa practice account?</span>
                    <button
                      type="button"
                      className="inline-link-btn"
                      onClick={() => setAuthMode('login')}
                    >
                      Sign In to Workspace →
                    </button>
                  </div>
                    </>
                  )}
                </div>

                {/* ────────── CARD 2: LOGIN ────────── */}
                <div className="auth-form-card login-card">
                  <div className="card-kicker-row">
                    <div>
                      <h1 className="card-title">Welcome Back</h1>
                      <p className="card-desc">
                        Sign in to manage your clients, cloud-stored documents, pending filings, and messaging workflows.
                      </p>
                    </div>
                  </div>

                  <form onSubmit={handleLoginSubmit} className="auth-fields-form">
                    <div className="field-group">
                      <label>Registered Work Email</label>
                      <div className="input-with-icon">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                        <input
                          type="email"
                          placeholder="ca@orvexa.ai or your email"
                          value={loginEmail}
                          onChange={(e) => setLoginEmail(e.target.value)}
                          disabled={lockoutSeconds > 0}
                          required
                        />
                      </div>
                    </div>

                    <div className="field-group">
                      <div className="field-label-split">
                        <label>Password</label>
                        <button
                          type="button"
                          className="forgot-link"
                          onClick={() => {
                            setForgotEmail(loginEmail || '');
                            setForgotModalOpen(true);
                          }}
                        >
                          Forgot Password?
                        </button>
                      </div>
                      <div className="input-with-icon">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                        <input
                          type={showLoginPass ? 'text' : 'password'}
                          placeholder="••••••••"
                          value={loginPassword}
                          onChange={(e) => setLoginPassword(e.target.value)}
                          disabled={lockoutSeconds > 0}
                          required
                        />
                        <button
                          type="button"
                          className="input-eye-btn"
                          onClick={() => setShowLoginPass(!showLoginPass)}
                        >
                          {showLoginPass ? 'Hide' : 'Show'}
                        </button>
                      </div>
                    </div>

                    <div className="auth-checkbox-row">
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={rememberMe}
                          onChange={(e) => setRememberMe(e.target.checked)}
                        />
                        <span>Remember credentials on this local workstation</span>
                      </label>
                    </div>

                    <button
                      type="submit"
                      className="auth-primary-btn"
                      disabled={isLoading || lockoutSeconds > 0}
                    >
                      {isLoading ? (
                        <span className="btn-spinner">Authenticating...</span>
                      ) : lockoutSeconds > 0 ? (
                        <span>Locked for {lockoutSeconds}s</span>
                      ) : (
                        <span>Sign In to Practice Workspace →</span>
                      )}
                    </button>
                  </form>

                  {/* Fast Pass Demo Access Button */}


                  <div className="card-footer-switch">
                    <span>Need to register a new CA account?</span>
                    <button
                      type="button"
                      className="inline-link-btn"
                      onClick={() => setAuthMode('signup')}
                    >
                      Create Practice Account →
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      {passwordResetHandoffOpen && (
        <div className="password-reset-handoff-overlay" role="dialog" aria-modal="true" aria-labelledby="password-reset-handoff-title">
          <div className="password-reset-handoff-card">
            <div className="password-reset-handoff-orbit" aria-hidden="true"><Icon name="check" size={25} /></div>
            <span className="auth-modal-kicker">SECURE RECOVERY COMPLETE</span>
            <h3 id="password-reset-handoff-title">Your password was reset successfully</h3>
                    <p>Your account is ready. Sign in to continue to your Orvexa AI workspace.</p>
            <button type="button" className="auth-primary-btn" onClick={() => setPasswordResetHandoffOpen(false)}>
              Continue to login <span aria-hidden="true">→</span>
            </button>
          </div>
        </div>
      )}

      {/* Forgot Password Modal */}
      {forgotModalOpen && (
        <div className="auth-modal-overlay">
          <div className="auth-modal-dialog">
            <div className="modal-header">
              <h3>Reset Practice Password</h3>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => {
                  setForgotModalOpen(false);
                  setForgotNotice(null);
                }}
              >
                ✕
              </button>
            </div>
            <p className="modal-desc">
              Enter your registered email address to receive secure password recovery instructions.
            </p>

            {forgotNotice ? (
              <div className="forgot-success-state" role="status" aria-live="polite">
                <div className="forgot-success-orbit" aria-hidden="true"><Icon name="check" size={22} /></div>
                <h4>Password reset email sent</h4>
                <p>{forgotNotice}</p>
                <p className="forgot-success-hint">Check your inbox and spam folder. The link will open a secure page where you can choose a new password.</p>
                <div className="forgot-cooldown-note">
                  <span className="forgot-cooldown-dot" aria-hidden="true" />
                  {forgotCooldown > 0 ? `You can request another email in ${forgotCooldown}s.` : 'You can request another email if needed.'}
                </div>
                <button
                  type="button"
                  className="btn gh forgot-done-btn"
                  onClick={() => {
                    setForgotModalOpen(false);
                    setForgotNotice(null);
                    setForgotError(null);
                  }}
                >
                  Done
                </button>
              </div>
            ) : (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!forgotEmail.trim() || forgotSending || forgotCooldown > 0) return;
                  setForgotSending(true);
                  setForgotError(null);
                  try {
                    const res = await apiForgotPassword(forgotEmail.trim());
                    if (!res.success) throw new Error(res.message || 'The reset email could not be sent.');
                    setForgotNotice(res.message || 'If an account exists for that email, a password reset link has been sent.');
                    setForgotCooldown(180);
                  } catch (error) {
                    setForgotError(error instanceof Error ? error.message : 'The reset email could not be sent. Please try again.');
                  } finally {
                    setForgotSending(false);
                  }
                }}
              >
                <div className="field-group" style={{ marginBottom: 14 }}>
                  <label>Practice Email</label>
                  <input
                    type="email"
                    className="modal-input"
                    value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)}
                    required
                  />
                </div>
                {forgotError && (
                  <div className="auth-alert auth-alert-error forgot-form-error" role="alert">
                    <Icon name="x" size={15} />
                    <span>{forgotError}</span>
                  </div>
                )}
                <div className="modal-btn-row">
                  <button
                    type="button"
                    className="btn-sec"
                    onClick={() => setForgotModalOpen(false)}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="auth-primary-btn forgot-submit-btn" style={{ width: 'auto', padding: '0 18px' }} disabled={forgotSending || forgotCooldown > 0}>
                    {forgotSending ? <><i className="spin" /> Sending…</> : forgotCooldown > 0 ? `Try again in ${forgotCooldown}s` : 'Send reset email'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
