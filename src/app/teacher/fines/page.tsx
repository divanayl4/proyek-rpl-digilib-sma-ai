import MyFinesView from "@/components/fines/MyFinesView";

export const metadata = {
  title: "Denda Saya - DigiLib",
};

export default function TeacherFinesPage() {
  return (
    <MyFinesView
      title="Denda Saya"
      subtitle="Denda keterlambatan dan kerusakan buku milik Anda"
    />
  );
}
