export default function OtpForm({ onSubmit, loading }) {
  return (
    <div className="card otp-form-placeholder">
      <h3>OTP Verification</h3>
      <p className="placeholder-subtext">OTP entry and resend timer component placeholder (Task F2).</p>
      {loading && <p className="loading-hint">Verifying OTP...</p>}
      <button
        type="button"
        style={{ display: 'none' }}
        onClick={() => onSubmit?.('')}
        aria-hidden="true"
      >
        Submit
      </button>
    </div>
  );
}
