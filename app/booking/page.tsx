"use client";

import { FormEvent, useMemo, useState } from "react";
import {
  BookingEntry,
  StudyTag,
  buildSelectionsForStartDate,
  formatDisplayDate,
  getBookingTag,
  getSlotOptions,
  getStudyConfig,
  sessionConfigs,
} from "@/lib/booking";

type AdminResponse = {
  bookings?: BookingEntry[];
  message?: string;
};

type StudyFilter = "all" | StudyTag;
type DateFilter = "all" | "this-week" | "next-week";
type FirstSessionSort = "asc" | "desc";

async function parseJsonResponse<T>(response: Response) {
  const text = await response.text();

  if (!text) {
    return {} as T;
  }

  return JSON.parse(text) as T;
}

function parseLocalDate(date: string) {
  const [year, month, day] = date.split("-").map(Number);

  if (!year || !month || !day) {
    return null;
  }

  const parsedDate = new Date(year, month - 1, day);
  parsedDate.setHours(0, 0, 0, 0);

  return parsedDate;
}

function getWeekStart(date: Date) {
  const weekStart = new Date(date);
  const weekday = weekStart.getDay();
  const daysSinceMonday = weekday === 0 ? 6 : weekday - 1;
  weekStart.setDate(weekStart.getDate() - daysSinceMonday);
  weekStart.setHours(0, 0, 0, 0);

  return weekStart;
}

function isFirstSessionInDateFilter(
  firstSessionDate: string,
  dateFilter: DateFilter,
) {
  if (dateFilter === "all") {
    return true;
  }

  const parsedDate = parseLocalDate(firstSessionDate);

  if (!parsedDate) {
    return false;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const weekStart = getWeekStart(today);
  if (dateFilter === "next-week") {
    weekStart.setDate(weekStart.getDate() + 7);
  }

  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  weekEnd.setHours(23, 59, 59, 999);

  return parsedDate >= weekStart && parsedDate <= weekEnd;
}

function compareFirstSessionDates(
  firstBooking: BookingEntry,
  secondBooking: BookingEntry,
  sortDirection: FirstSessionSort,
) {
  const firstDate = parseLocalDate(firstBooking.firstSessionDate)?.getTime() ?? 0;
  const secondDate =
    parseLocalDate(secondBooking.firstSessionDate)?.getTime() ?? 0;
  const comparison = firstDate - secondDate;

  if (comparison !== 0) {
    return sortDirection === "asc" ? comparison : -comparison;
  }

  return firstBooking.email.localeCompare(secondBooking.email);
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
  const [studyFilter, setStudyFilter] = useState<StudyFilter>("all");
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [firstSessionSort, setFirstSessionSort] =
    useState<FirstSessionSort>("asc");

  const visibleBookings = useMemo(() => {
    return bookings
      .filter((booking) => {
        const matchesStudy =
          studyFilter === "all" || getBookingTag(booking) === studyFilter;
        const matchesDate = isFirstSessionInDateFilter(
          booking.firstSessionDate,
          dateFilter,
        );

        return matchesStudy && matchesDate;
      })
      .toSorted((firstBooking, secondBooking) =>
        compareFirstSessionDates(firstBooking, secondBooking, firstSessionSort),
      );
  }, [bookings, dateFilter, firstSessionSort, studyFilter]);

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
          <>
            <div className="bookings-controls" aria-label="Booking filters">
              <label>
                <span>Study type</span>
                <select
                  value={studyFilter}
                  onChange={(event) =>
                    setStudyFilter(event.target.value as StudyFilter)
                  }
                >
                  <option value="all">All studies</option>
                  <option value="meg-study">MEG experiment</option>
                  <option value="sensorimotor-study">Sensorimotor study</option>
                </select>
              </label>
              <label>
                <span>First session date</span>
                <select
                  value={dateFilter}
                  onChange={(event) =>
                    setDateFilter(event.target.value as DateFilter)
                  }
                >
                  <option value="all">All dates</option>
                  <option value="this-week">This week</option>
                  <option value="next-week">Next week</option>
                </select>
              </label>
              <label>
                <span>Sort first session</span>
                <select
                  value={firstSessionSort}
                  onChange={(event) =>
                    setFirstSessionSort(event.target.value as FirstSessionSort)
                  }
                >
                  <option value="asc">Earliest first</option>
                  <option value="desc">Latest first</option>
                </select>
              </label>
              <p>{visibleBookings.length} shown</p>
            </div>

            {visibleBookings.length === 0 ? (
              <p className="empty-bookings">
                No bookings match the selected filters.
              </p>
            ) : (
              <div className="bookings-table-wrap">
                <table className="bookings-table">
                  <thead>
                    <tr>
                      <th>Email</th>
                      <th>Study</th>
                      <th>First session</th>
                      {sessionConfigs.map((session) => (
                        <th key={session.id}>{session.title}</th>
                      ))}
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleBookings.map((booking) => {
                      const isEditing = editingBooking?.id === booking.id;
                      const rowBooking = isEditing ? editingBooking : booking;
                      const rowTag = getBookingTag(rowBooking);
                      const rowStudy = getStudyConfig(rowTag);
                      const rowSlotOptions = getSlotOptions(rowTag);

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
                          <td>{rowStudy.title}</td>
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
                                  {rowSlotOptions.map((slot) => (
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
            )}
          </>
        ) : null}
      </section>
    </main>
  );
}
