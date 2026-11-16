import { executeTool } from "@/lib/ai/tools";
test("tool dir", async () => {
  const raw = await executeTool("get_user_directory", {}, "5a7af1f3-0d69-4a81-951a-f7982e1e3d1a", "ADMIN");
  const data = JSON.parse(raw);
  console.log("TOTAL:", data.total, "SHOWN:", data.shown);
  console.log("NAMES:", data.users.map((u:any) => u.name).join(", "));
});
