import { readFile } from "fs/promises";
import path from "path";
import { BookingEntry, formatDisplayDate, sessionConfigs } from "@/lib/booking";

async function getBookings() {
  try {
    const file = await readFile(
      path.join(process.cwd(), "data", "bookings.json"),
      "utf8",
    );
    const bookings = JSON.parse(file) as BookingEntry[];

    return bookings.filter((booking) =>
      sessionConfigs.every((session) => {
        const selection = booking.selections?.[session.id];
        return selection?.day && selection?.date && selection?.slot;
      }),
    );
  } catch {
    return [];
  }
}

export default async function BookingsPage() {
  const bookings = await getBookings();

  return (
    <main className="page-shell">
      <section className="bookings-admin">
        <div className="bookings-admin-header">
          <div>
            <p className="eyebrow">MEG experiment</p>
            <h1>Participant bookings</h1>
          </div>
          <strong>{bookings.length} total</strong>
        </div>

        {bookings.length > 0 ? (
          <div className="bookings-table-wrap">
            <table className="bookings-table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>First session</th>
                  {sessionConfigs.map((session) => (
                    <th key={session.id}>{session.title}</th>
                  ))}
                  <th>Saved</th>
                </tr>
              </thead>
              <tbody>
                {bookings.map((booking) => (
                  <tr key={booking.id}>
                    <td>{booking.email}</td>
                    <td>{formatDisplayDate(booking.firstSessionDate)}</td>
                    {sessionConfigs.map((session) => (
                      <td key={session.id}>
                        <span>
                          {booking.selections[session.id].day},{" "}
                          {formatDisplayDate(
                            booking.selections[session.id].date,
                          )}
                        </span>
                        <strong>{booking.selections[session.id].slot}</strong>
                      </td>
                    ))}
                    <td>
                      {formatDisplayDate(
                        (booking.updatedAt ?? booking.createdAt).slice(0, 10),
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty-bookings">No bookings have been saved yet.</p>
        )}
      </section>
    </main>
  );
}
