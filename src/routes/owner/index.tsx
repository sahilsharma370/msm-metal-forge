import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { OwnerShell } from "@/components/owner/OwnerShell";

const title = "Owner workspace | MSM Scrap";

export const Route = createFileRoute("/owner/")({
  head: () => ({ meta: [{ title }] }),
  component: OwnerIndexRouteComponent,
});

function OwnerIndexRouteComponent() {
  const navigate = useNavigate();

  return (
    <OwnerShell
      onUnauthorized={(reason) =>
        navigate({
          to: "/owner/login",
          search: { redirect: "/owner", reason: reason === "unauthorized" ? "unauthorized" : undefined },
        })
      }
    />
  );
}
