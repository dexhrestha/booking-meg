"use client";

import { FormEvent, useState } from "react";

type FormStatus =
  | { kind: "idle"; message: "" }
  | { kind: "error" | "success"; message: string };

export function SeptemberSignupForm() {
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [status, setStatus] = useState<FormStatus>({
    kind: "idle",
    message: "",
  });

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setStatus({ kind: "idle", message: "" });

    try {
      const response = await fetch("/api/september-signups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = (await response.json()) as { message?: string };

      if (!response.ok) {
        throw new Error(data.message ?? "We couldn’t save your email.");
      }

      setEmail("");
      setStatus({
        kind: "success",
        message: data.message ?? "You’re on the list. See you in September!",
      });
    } catch (error) {
      setStatus({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "We couldn’t save your email. Please try again.",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="pause-form" onSubmit={handleSubmit}>
      <label htmlFor="pause-email">Email address</label>
      <div className="pause-form-row">
        <input
          autoComplete="email"
          id="pause-email"
          name="email"
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          required
          type="email"
          value={email}
        />
        <button disabled={isSubmitting} type="submit">
          {isSubmitting ? "Saving…" : "Notify me"}
        </button>
      </div>
      <p className="pause-privacy">
        We’ll only use your email to contact you about bookings reopening.
      </p>
      <p
        aria-live="polite"
        className="pause-form-status"
        data-kind={status.kind}
        role="status"
      >
        {status.message}
      </p>
    </form>
  );
}
