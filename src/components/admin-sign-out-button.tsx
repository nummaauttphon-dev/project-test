import { signOutAction } from "@/features/admin/actions";

export function AdminSignOutButton() {
  return (
    <form action={signOutAction}>
      <button
        type="submit"
        className="inline-flex min-h-11 items-center rounded-sm border border-line-strong px-5 font-semibold hover:bg-sunken"
      >
        ออกจากระบบ
      </button>
    </form>
  );
}
