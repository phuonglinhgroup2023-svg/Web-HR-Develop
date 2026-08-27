async function refreshAdminState() {
  const status = document.getElementById('admin-status');
  const preview = document.getElementById('admin-preview-item');

  try {
    const response = await fetch('/api/presentation');
    if (!response.ok) {
      if (status) status.textContent = 'Chưa có deck';
      if (preview) preview.textContent = 'Chưa có file nào được upload.';
      return;
    }

    const manifest = await response.json();
    if (status) status.textContent = 'Deck đã sẵn sàng';
    if (preview) {
      preview.textContent = `Đang dùng deck: ${manifest.sourceName} • ${manifest.slideCount} slide`;
    }
  } catch (error) {
    console.error(error);
    if (status) status.textContent = 'Không kết nối được server';
    if (preview) preview.textContent = 'Không thể đọc trạng thái deck từ server.';
  }
}

async function handleUpload() {
  const input = document.getElementById('pptx-file');
  const file = input?.files?.[0];
  if (!file) {
    alert('Vui lòng chọn file PowerPoint.');
    return;
  }

  if (!/^video\/(mp4|webm|ogg)$/i.test(file.type) && !/\.(mp4|webm|ogg)$/i.test(file.name)) {
    alert('Vui lòng chọn video MP4, WebM hoặc OGG.');
    return;
  }

  const uploadBtn = document.getElementById('upload-btn');
  if (uploadBtn) {
    uploadBtn.disabled = true;
    uploadBtn.textContent = 'Đang upload...';
  }

  try {
    const formData = new FormData();
    formData.append('pptx-file', file);

    const response = await fetch('/api/upload-presentation', {
      method: 'POST',
      body: formData,
    });

    const result = await response.json();
    if (!response.ok) {
      throw new Error(result?.error || 'Upload failed');
    }

    alert(`Đã upload xong: ${result.sourceName}`);
    await refreshAdminState();
  } catch (error) {
    console.error(error);
    alert(`Upload thất bại: ${error.message}`);
  } finally {
    if (uploadBtn) {
      uploadBtn.disabled = false;
      uploadBtn.textContent = 'Upload video';
    }
  }
}

async function handleClear() {
  const clearBtn = document.getElementById('clear-btn');
  if (clearBtn) {
    clearBtn.disabled = true;
    clearBtn.textContent = 'Đang xóa...';
  }

  try {
    const response = await fetch('/api/clear-presentation', { method: 'POST' });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result?.error || 'Clear failed');
    }

    const input = document.getElementById('pptx-file');
    if (input) input.value = '';
    await refreshAdminState();
  } catch (error) {
    console.error(error);
    alert(`Không thể xóa deck: ${error.message}`);
  } finally {
    if (clearBtn) {
      clearBtn.disabled = false;
      clearBtn.textContent = 'Xóa deck';
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  refreshAdminState();
  document.getElementById('upload-btn')?.addEventListener('click', handleUpload);
  document.getElementById('clear-btn')?.addEventListener('click', handleClear);
});
