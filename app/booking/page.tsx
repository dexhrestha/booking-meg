"use client";

import { FormEvent, useState } from "react";
import {
  BookingEntry,
  buildSelectionsForStartDate,
  formatDisplayDate,
  sessionConfigs,
  slotOptions,
} from "@/lib/booking";

type AdminResponse = {
  bookings?: BookingEntry[];
  message?: string;
};

async function parseJsonResponse<T>(response: Response) {
  const text = await response.text();

  if (!text) {
    return {} as T;
  }

  return JSON.parse(text) as T;
}

export default function ViewBookingsPage() {
  const [password, setPassword] = useState("");
  const [bookings, setBookings] = useState<BookingEntry[]>([]);
  const [editingBooking, setEditingBooking] = useState<BookingEntry | null>(
    null,
  );
  const [authenticated, setAuthenticated] = useState(false);
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  async function requestAdminBookings(
    method: "GET" | "PUT" | "DELETE",
    body?: object,
  ) {
    const response = await fetch("/api/admin/bookings", {
      method,
      headers: {
        "Content-Type": "application/json",
        "x-admin-password": password,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await parseJsonResponse<AdminResponse>(response);

    if (!response.ok) {
      throw new Error(data.message ?? "Request failed.");
    }

    return data;
  }

  async function unlockBookings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsLoading(true);
    setMessage("");

    try {
      const data = await requestAdminBookings("GET");
      setBookings(data.bookings ?? []);
      setAuthenticated(true);
    } catch (error) {
      setAuthenticated(false);
      setMessage(error instanceof Error ? error.message : "Could not unlock.");
    } finally {
      setIsLoading(false);
    }
  }

  function updateEditingBooking(nextBooking: BookingEntry) {
    setEditingBooking(nextBooking);
  }

  function updateStartDate(firstSessionDate: string) {
    if (!editingBooking) {
      return;
    }

    updateEditingBooking({
      ...editingBooking,
      firstSessionDate,
      selections: buildSelectionsForStartDate(
        firstSessionDate,
        editingBooking.selections,
      ),
    });
  }

  async function saveBooking() {
    if (!editingBooking) {
      return;
    }

    setIsLoading(true);
    setMessage("");

    try {
      const data = await requestAdminBookings("PUT", {
        booking: editingBooking,
      });
      setBookings(data.bookings ?? []);
      setEditingBooking(null);
      setMessage(data.message ?? "Booking updated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update.");
    } finally {
      setIsLoading(false);
    }
  }

  async function removeBooking(id: string) {
    if (!window.confirm("Remove this booking?")) {
      return;
    }

    setIsLoading(true);
    setMessage("");

    try {
      const data = await requestAdminBookings("DELETE", { id });
      setBookings(data.bookings ?? []);
      setEditingBooking((current) => (current?.id === id ? null : current));
      setMessage(data.message ?? "Booking removed.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not remove.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="page-shell">
      <section className="bookings-admin">
        <div className="bookings-admin-header">
          <div>
            <p className="eyebrow">MEG experiment</p>
            <h1>Participant bookings</h1>
          </div>
          {authenticated ? <strong>{bookings.length} total</strong> : null}
        </div>

        {!authenticated ? (
          <form className="admin-password-form" onSubmit={unlockBookings}>
            <label>
              <span>Password</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Enter password"
                required
              />
            </label>
            <button type="submit" disabled={isLoading}>
              {isLoading ? "Checking..." : "View bookings"}
            </button>
          </form>
        ) : null}

        {message ? (
          <p className="form-message" role="alert">
            {message}
          </p>
        ) : null}

        {authenticated && bookings.length === 0 ? (
          <p className="empty-bookings">No bookings have been saved yet.</p>
        ) : null}

        {authenticated && bookings.length > 0 ? (
          <div className="bookings-table-wrap">
            <table className="bookings-table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>First session</th>
                  {sessionConfigs.map((session) => (
                    <th key={session.id}>{session.title}</th>
                  ))}
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {bookings.map((booking) => {
                  const isEditing = editingBooking?.id === booking.id;
                  const rowBooking = isEditing ? editingBooking : booking;

                  return (
                    <tr key={booking.id}>
                      <td>
                        {isEditing ? (
                          <input
                            className="admin-table-input"
                            type="email"
                            value={rowBooking.email}
                            onChange={(event) =>
                              updateEditingBooking({
                                ...rowBooking,
                                email: event.target.value,
                              })
                            }
                          />
                        ) : (
                          booking.email
                        )}
                      </td>
                      <td>
                        {isEditing ? (
                          <input
                            className="admin-table-input"
                            type="date"
                            value={rowBooking.firstSessionDate}
                            onChange={(event) =>
                              updateStartDate(event.target.value)
                            }
                          />
                        ) : (
                          formatDisplayDate(booking.firstSessionDate)
                        )}
                      </td>
                      {sessionConfigs.map((session) => (
                        <td key={session.id}>
                          <span>
                            {rowBooking.selections[session.id].day},{" "}
                            {formatDisplayDate(
                              rowBooking.selections[session.id].date,
                            )}
                          </span>
                          {isEditing ? (
                            <select
                              className="admin-table-input"
                              value={rowBooking.selections[session.id].slot}
                              onChange={(event) =>
                                updateEditingBooking({
                                  ...rowBooking,
                                  selections: {
                                    ...rowBooking.selections,
                                    [session.id]: {
                                      ...rowBooking.selections[session.id],
                                      slot: event.target.value,
                                    },
                                  },
                                })
                              }
                            >
                              {slotOptions.map((slot) => (
                                <option value={slot} key={slot}>
                                  {slot}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <strong>
                              {booking.selections[session.id].slot}
                            </strong>
                          )}
                        </td>
                      ))}
                      <td>
                        <div className="admin-actions">
                          {isEditing ? (
                            <>
                              <button
                                type="button"
                                onClick={saveBooking}
                                disabled={isLoading}
                              >
                                Save
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingBooking(null)}
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() => setEditingBooking(booking)}
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => removeBooking(booking.id)}
                                disabled={isLoading}
                              >
                                Remove
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </main>
  );
}
