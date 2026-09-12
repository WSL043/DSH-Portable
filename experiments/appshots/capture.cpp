// Independent Windows Appshot experiment. Uses public Windows APIs only.
#define NOMINMAX
#include <windows.h>
#include <d3d11.h>
#include <dxgi.h>
#include <dwmapi.h>
#include <wincodec.h>
#include <wincrypt.h>
#include <UIAutomation.h>
#include <windows.graphics.capture.interop.h>
#include <windows.graphics.directx.direct3d11.interop.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Data.Json.h>
#include <winrt/Windows.Graphics.Capture.h>
#include <winrt/Windows.Graphics.DirectX.h>
#include <winrt/Windows.Graphics.DirectX.Direct3D11.h>
#include <chrono>
#include <iostream>
#include <queue>
#include <set>
#include <string>
#include <vector>

using namespace winrt;
using namespace winrt::Windows::Data::Json;
using namespace winrt::Windows::Graphics::Capture;
using namespace winrt::Windows::Graphics::DirectX;
using namespace winrt::Windows::Graphics::DirectX::Direct3D11;
using Clock = std::chrono::steady_clock;

static void emit(JsonObject const& value) { std::cout << to_string(value.Stringify()) << std::endl; }
static JsonObject captureEvent(wchar_t const* type) {
    JsonObject value; value.SetNamedValue(L"type", JsonValue::CreateStringValue(type)); return value;
}
static void validate(HWND window, DWORD owner) {
    DWORD current = 0, affinity = 0;
    GetWindowThreadProcessId(window, &current);
    if (!IsWindow(window) || current != owner || !IsWindowVisible(window) || IsIconic(window))
        throw hresult_invalid_argument(L"Window closed, changed owner, hidden, or minimized.");
    if (!MonitorFromWindow(window, MONITOR_DEFAULTTONULL))
        throw hresult_invalid_argument(L"Window is outside the visible desktop.");
    if (GetWindowDisplayAffinity(window, &affinity) && affinity != WDA_NONE)
        throw hresult_access_denied(L"This window does not allow capture.");
    DWORD cloaked = 0;
    if (SUCCEEDED(DwmGetWindowAttribute(window, DWMWA_CLOAKED, &cloaked, sizeof(cloaked))) && cloaked)
        throw hresult_invalid_argument(L"Window is not on the visible desktop.");
}

static std::wstring png(ID3D11Texture2D* texture, ID3D11Device* device, ID3D11DeviceContext* context,
                        UINT width, UINT height) {
    D3D11_TEXTURE2D_DESC desc; texture->GetDesc(&desc);
    desc.Usage = D3D11_USAGE_STAGING; desc.BindFlags = 0;
    desc.CPUAccessFlags = D3D11_CPU_ACCESS_READ; desc.MiscFlags = 0;
    com_ptr<ID3D11Texture2D> staging; check_hresult(device->CreateTexture2D(&desc, nullptr, staging.put()));
    context->CopyResource(staging.get(), texture);
    D3D11_MAPPED_SUBRESOURCE mapped;
    check_hresult(context->Map(staging.get(), 0, D3D11_MAP_READ, 0, &mapped));
    std::vector<BYTE> pixels(static_cast<size_t>(width) * height * 4);
    for (UINT y = 0; y < height; ++y)
        memcpy(pixels.data() + static_cast<size_t>(y) * width * 4,
               static_cast<BYTE*>(mapped.pData) + static_cast<size_t>(y) * mapped.RowPitch, width * 4);
    context->Unmap(staging.get(), 0);
    auto factory = create_instance<IWICImagingFactory>(CLSID_WICImagingFactory);
    com_ptr<IStream> stream; check_hresult(CreateStreamOnHGlobal(nullptr, TRUE, stream.put()));
    com_ptr<IWICBitmapEncoder> encoder; check_hresult(factory->CreateEncoder(GUID_ContainerFormatPng, nullptr, encoder.put()));
    check_hresult(encoder->Initialize(stream.get(), WICBitmapEncoderNoCache));
    com_ptr<IWICBitmapFrameEncode> frame; check_hresult(encoder->CreateNewFrame(frame.put(), nullptr));
    check_hresult(frame->Initialize(nullptr)); check_hresult(frame->SetSize(width, height));
    WICPixelFormatGUID format = GUID_WICPixelFormat32bppBGRA;
    check_hresult(frame->SetPixelFormat(&format));
    if (format != GUID_WICPixelFormat32bppBGRA) throw hresult_error(E_FAIL, L"Unexpected PNG pixel format.");
    check_hresult(frame->WritePixels(height, width * 4, static_cast<UINT>(pixels.size()), pixels.data()));
    check_hresult(frame->Commit()); check_hresult(encoder->Commit());
    STATSTG stat{}; check_hresult(stream->Stat(&stat, STATFLAG_NONAME));
    if (stat.cbSize.QuadPart > 16 * 1024 * 1024) throw hresult_error(E_FAIL, L"Image exceeds 16 MiB.");
    HGLOBAL memory; check_hresult(GetHGlobalFromStream(stream.get(), &memory));
    auto bytes = static_cast<BYTE*>(GlobalLock(memory));
    DWORD length = 0;
    CryptBinaryToStringW(bytes, stat.cbSize.LowPart, CRYPT_STRING_BASE64 | CRYPT_STRING_NOCRLF, nullptr, &length);
    std::wstring encoded(length, L'\0');
    BOOL ok = CryptBinaryToStringW(bytes, stat.cbSize.LowPart, CRYPT_STRING_BASE64 | CRYPT_STRING_NOCRLF, &encoded[0], &length);
    GlobalUnlock(memory); if (!ok) throw hresult_error(E_FAIL, L"PNG encoding failed.");
    encoded.resize(length); if (!encoded.empty() && encoded.back() == L'\0') encoded.pop_back();
    return L"data:image/png;base64," + encoded;
}

static void capture(HWND window, DWORD owner) {
    validate(window, owner);
    if (!GraphicsCaptureSession::IsSupported()) throw hresult_error(E_NOTIMPL, L"Windows Graphics Capture is unavailable.");
    auto interop = get_activation_factory<GraphicsCaptureItem, IGraphicsCaptureItemInterop>();
    GraphicsCaptureItem item{nullptr};
    check_hresult(interop->CreateForWindow(window, guid_of<GraphicsCaptureItem>(), put_abi(item)));
    auto size = item.Size();
    if (size.Width <= 0 || size.Height <= 0 || static_cast<int64_t>(size.Width) * size.Height > 16777216)
        throw hresult_invalid_argument(L"Window dimensions exceed the experiment limit.");
    com_ptr<ID3D11Device> device; com_ptr<ID3D11DeviceContext> context;
    check_hresult(D3D11CreateDevice(nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr, D3D11_CREATE_DEVICE_BGRA_SUPPORT,
        nullptr, 0, D3D11_SDK_VERSION, device.put(), nullptr, context.put()));
    com_ptr<::IInspectable> inspectable;
    check_hresult(CreateDirect3D11DeviceFromDXGIDevice(device.as<IDXGIDevice>().get(), inspectable.put()));
    auto pool = Direct3D11CaptureFramePool::CreateFreeThreaded(inspectable.as<IDirect3DDevice>(),
        DirectXPixelFormat::B8G8R8A8UIntNormalized, 2, size);
    auto session = pool.CreateCaptureSession(item);
    try { session.IsCursorCaptureEnabled(false); } catch (hresult_error const&) { }
    // Keep the OS capture indicator. Do not request borderless capture privileges.
    session.StartCapture();
    Direct3D11CaptureFrame frame{nullptr};
    auto deadline = Clock::now() + std::chrono::seconds(2);
    while (!(frame = pool.TryGetNextFrame()) && Clock::now() < deadline) Sleep(10);
    if (!frame) { session.Close(); pool.Close(); throw hresult_error(HRESULT_FROM_WIN32(WAIT_TIMEOUT), L"No window frame arrived."); }
    validate(window, owner);
    auto actual = frame.ContentSize();
    // A resize during capture must not silently stretch, crop, or read uninitialized pixels.
    if (actual.Width != size.Width || actual.Height != size.Height)
        throw hresult_error(E_ABORT, L"Window resized during capture. Try again.");
    auto access = frame.Surface().as<::Windows::Graphics::DirectX::Direct3D11::IDirect3DDxgiInterfaceAccess>();
    com_ptr<ID3D11Texture2D> texture; check_hresult(access->GetInterface(__uuidof(ID3D11Texture2D), texture.put_void()));
    auto data = png(texture.get(), device.get(), context.get(), size.Width, size.Height);
    frame.Close(); session.Close(); pool.Close();
    auto result = captureEvent(L"image");
    result.SetNamedValue(L"dataUrl", JsonValue::CreateStringValue(data));
    result.SetNamedValue(L"width", JsonValue::CreateNumberValue(size.Width));
    result.SetNamedValue(L"height", JsonValue::CreateNumberValue(size.Height));
    emit(result); // The image survives a subsequent unresponsive UIA provider.
}

static void text(HWND window, DWORD owner) {
    validate(window, owner);
    auto automation = create_instance<IUIAutomation>(CLSID_CUIAutomation);
    com_ptr<IUIAutomationElement> root; check_hresult(automation->ElementFromHandle(window, root.put()));
    com_ptr<IUIAutomationTreeWalker> walker; check_hresult(automation->get_ControlViewWalker(walker.put()));
    std::queue<com_ptr<IUIAutomationElement>> queue; queue.push(root);
    std::set<std::wstring> seen; std::wstring content;
    unsigned visited = 0; auto deadline = Clock::now() + std::chrono::milliseconds(1500);
    auto append = [&](BSTR value) {
        if (!value || !*value || content.size() >= 24000) return;
        std::wstring part(value, SysStringLen(value));
        if (seen.insert(part).second) { if (!content.empty()) content += L'\n'; content += part.substr(0, 24000 - content.size()); }
    };
    while (!queue.empty() && visited < 400 && content.size() < 24000 && Clock::now() < deadline) {
        auto element = queue.front(); queue.pop(); ++visited;
        BOOL password = TRUE;
        if (FAILED(element->get_CurrentIsPassword(&password)) || password) continue;
        // Do not use a document-wide TextPattern: it could include descendant password fields.
        com_ptr<IUIAutomationValuePattern> value;
        if (SUCCEEDED(element->GetCurrentPatternAs(UIA_ValuePatternId, __uuidof(IUIAutomationValuePattern), value.put_void())) && value) {
            BSTR data = nullptr; if (SUCCEEDED(value->get_CurrentValue(&data))) append(data); SysFreeString(data);
        }
        BSTR name = nullptr; if (SUCCEEDED(element->get_CurrentName(&name))) append(name); SysFreeString(name);
        com_ptr<IUIAutomationElement> child;
        if (SUCCEEDED(walker->GetFirstChildElement(element.get(), child.put()))) {
            while (child && queue.size() + visited < 400 && Clock::now() < deadline) {
                queue.push(child); com_ptr<IUIAutomationElement> next;
                if (FAILED(walker->GetNextSiblingElement(child.get(), next.put()))) break;
                child = std::move(next);
            }
        }
    }
    validate(window, owner);
    auto result = captureEvent(L"text");
    result.SetNamedValue(L"text", JsonValue::CreateStringValue(content));
    result.SetNamedValue(L"partial", JsonValue::CreateBooleanValue(!queue.empty() || visited >= 400 || content.size() >= 24000));
    result.SetNamedValue(L"nodes", JsonValue::CreateNumberValue(visited)); emit(result);
}

int wmain(int argc, wchar_t** argv) {
    wchar_t const* phase = L"image";
    try {
        init_apartment(apartment_type::multi_threaded);
        SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
        if (argc != 3) throw hresult_invalid_argument(L"Usage: capture <window handle> <process id>");
        HWND window = reinterpret_cast<HWND>(std::stoull(argv[1])); DWORD owner = std::stoul(argv[2]);
        capture(window, owner);
        phase = L"text";
        text(window, owner);
        return 0;
    } catch (hresult_error const& error) {
        auto result = captureEvent(L"error"); result.SetNamedValue(L"phase", JsonValue::CreateStringValue(phase));
        result.SetNamedValue(L"message", JsonValue::CreateStringValue(error.message())); emit(result); return 1;
    } catch (...) { emit(captureEvent(L"error")); return 1; }
}
