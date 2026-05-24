"use client";

import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  usePopover,
} from "@/components/ui/popover";
import {
  formatDisplayDate,
  getLatestFirstSessionDate,
  isAllowedFirstSessionDate,
} from "@/lib/booking";

type FirstSessionDatePickerProps = {
  value: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  invalid: boolean;
};

function dateFromIso(value: string) {
  if (!value) {
    return undefined;
  }

  const [year, month, day] = value.split("-").map(Number);

  if (!year || !month || !day) {
    return undefined;
  }

  return new Date(year, month - 1, day);
}

function dateToIso(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function isUnavailableFirstSessionDate(date: Date) {
  return !isAllowedFirstSessionDate(dateToIso(date));
}

export function FirstSessionDatePicker({
  value,
  onChange,
  onBlur,
  invalid,
}: FirstSessionDatePickerProps) {
  const selectedDate = dateFromIso(value);

  return (
    <Popover>
      <PopoverTrigger>
        <span>{value ? formatDisplayDate(value) : "Pick a date"}</span>
      </PopoverTrigger>
      <PopoverContent>
        <DatePickerCalendar
          selectedDate={selectedDate}
          onChange={onChange}
          onBlur={onBlur}
          invalid={invalid}
        />
      </PopoverContent>
    </Popover>
  );
}

function DatePickerCalendar({
  selectedDate,
  onChange,
  onBlur,
  invalid,
}: {
  selectedDate?: Date;
  onChange: (value: string) => void;
  onBlur: () => void;
  invalid: boolean;
}) {
  const { setOpen } = usePopover();

  return (
    <>
      <Calendar
        selected={selectedDate}
        onSelect={(date) => {
          if (!date) {
            return;
          }

          onChange(dateToIso(date));
          onBlur();
          setOpen(false);
        }}
        disabled={isUnavailableFirstSessionDate}
      />
      <p className="date-picker-note" data-invalid={invalid}>
        Select a Monday or Tuesday within the next 4 weeks, through{" "}
        {formatDisplayDate(getLatestFirstSessionDate())}.
      </p>
    </>
  );
}
