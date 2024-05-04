import { FileResponse, open } from "@tauri-apps/plugin-dialog";

type ChildrenFnParams = { onClick: () => void };

type Error = {
  message: string;
  data?: any;
};

type VideoPickerProps = {
  children: (_: ChildrenFnParams) => React.ReactNode;
  onSuccess?: (_: { file: FileResponse }) => void;
  onError?: (_: Error) => void;
};

export const extensions = ["mp4", "mov", "mkv", "avi", "webm"];

export default function VideoPicker({
  children,
  onSuccess,
  onError,
}: VideoPickerProps) {
  async function onClick() {
    try {
      const file = await open({
        directory: false,
        multiple: false,
        title: "Select video to compress",
        filters: [{ name: "video", extensions }],
      });
      if (file == null) {
        const message = "File selection config is invalid.";
        console.warn(message);
        onError?.({ message });
        return;
      }
      onSuccess?.({ file });
    } catch (error: any) {
      onError?.({
        message: error?.message ?? "Could not select video.",
        data: error,
      });
    }
  }

  return children({ onClick });
}
