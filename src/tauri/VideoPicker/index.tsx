import { open } from "@tauri-apps/plugin-dialog";

type ChildrenFnParams = { onClick: () => void };

type VideoPickerProps = {
  children: (_: ChildrenFnParams) => React.ReactNode;
  onSuccess?: (_: { path: string }) => void;
  onError?: (_: any) => void;
};

export default function VideoPicker({
  children,
  onSuccess,
  onError,
}: VideoPickerProps) {
  async function onClick() {
    try {
      const path = await open({
        directory: false,
        multiple: false,
        title: "Select video to compress",
        filters: [
          { name: "video", extensions: ["mp4", "mov", "mkv", "avi", "webm"] },
        ],
      });
      if (path == null || Array.isArray(path)) {
        console.warn("File selection config is invalid.");
        return;
      }
      onSuccess?.({ path });
    } catch (error) {
      onError?.(error);
    }
  }

  return children({ onClick });
}
