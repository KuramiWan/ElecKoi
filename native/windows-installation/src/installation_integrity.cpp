#include <windows.h>
#include <aclapi.h>
#include <sddl.h>
#include <cstdio>
#include <string>
#include <vector>

namespace {
class Handle {
 public:
  explicit Handle(HANDLE value) : value_(value) {}
  ~Handle() { if (value_ != INVALID_HANDLE_VALUE && value_ != nullptr) CloseHandle(value_); }
  HANDLE get() const { return value_; }
 private:
  HANDLE value_;
};
class LocalMemory {
 public:
  explicit LocalMemory(void* value = nullptr) : value_(value) {}
  ~LocalMemory() { if (value_ != nullptr) LocalFree(value_); }
 private:
  void* value_;
};

DWORD Report(const wchar_t* operation, const std::wstring& path, DWORD code) {
  fwprintf(stderr, L"%ls failed (%lu): %ls\n", operation, code, path.c_str());
  return code;
}

// Work through a file handle and refuse reparse points; no parent or directory
// labels, owners, audit rules, or unrelated access entries are changed.
DWORD RepairExecutable(const std::wstring& path, PSID user) {
  Handle file(CreateFileW(path.c_str(), READ_CONTROL | WRITE_DAC,
      FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, nullptr,
      OPEN_EXISTING, FILE_FLAG_OPEN_REPARSE_POINT, nullptr));
  if (file.get() == INVALID_HANDLE_VALUE) return Report(L"Open executable", path, GetLastError());
  FILE_ATTRIBUTE_TAG_INFO attributes{};
  if (!GetFileInformationByHandleEx(file.get(), FileAttributeTagInfo, &attributes, sizeof(attributes))) {
    return Report(L"Inspect executable", path, GetLastError());
  }
  if ((attributes.FileAttributes & (FILE_ATTRIBUTE_REPARSE_POINT | FILE_ATTRIBUTE_DIRECTORY)) != 0) {
    return Report(L"Reject linked executable", path, ERROR_REPARSE_TAG_INVALID);
  }
  BY_HANDLE_FILE_INFORMATION identity{};
  if (!GetFileInformationByHandle(file.get(), &identity)) return Report(L"Inspect file identity", path, GetLastError());
  if (identity.nNumberOfLinks != 1) return Report(L"Reject multiply linked executable", path, ERROR_TOO_MANY_LINKS);
  PACL dacl = nullptr;
  PACL sacl = nullptr;
  PSECURITY_DESCRIPTOR descriptor = nullptr;
  DWORD result = GetSecurityInfo(file.get(), SE_FILE_OBJECT,
      DACL_SECURITY_INFORMATION | LABEL_SECURITY_INFORMATION,
      nullptr, nullptr, &dacl, &sacl, &descriptor);
  if (result != ERROR_SUCCESS) return Report(L"Read executable security", path, result);
  LocalMemory descriptor_memory(descriptor);
  bool low = false;
  if (sacl != nullptr) {
    for (DWORD index = 0; index < sacl->AceCount; ++index) {
      void* raw = nullptr;
      if (!GetAce(sacl, index, &raw)) return Report(L"Read integrity entry", path, GetLastError());
      const auto* header = static_cast<ACE_HEADER*>(raw);
      if (header->AceType != SYSTEM_MANDATORY_LABEL_ACE_TYPE) continue;
      auto* label = static_cast<SYSTEM_MANDATORY_LABEL_ACE*>(raw);
      PSID sid = &label->SidStart;
      if (!IsValidSid(sid) || *GetSidSubAuthorityCount(sid) != 1) {
        return Report(L"Invalid integrity SID", path, ERROR_INVALID_SID);
      }
      low = low || *GetSidSubAuthority(sid, 0) < SECURITY_MANDATORY_MEDIUM_RID;
    }
  }
  if (!low) return ERROR_SUCCESS;

  PSECURITY_DESCRIPTOR medium_descriptor = nullptr;
  if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(
      L"S:(ML;;NW;;;ME)", SDDL_REVISION_1, &medium_descriptor, nullptr)) {
    return Report(L"Build medium label", path, GetLastError());
  }
  LocalMemory medium_memory(medium_descriptor);
  BOOL present = FALSE;
  BOOL defaulted = FALSE;
  PACL medium = nullptr;
  if (!GetSecurityDescriptorSacl(medium_descriptor, &present, &medium, &defaulted) || !present) {
    return Report(L"Read medium label", path, ERROR_INVALID_SECURITY_DESCR);
  }

  // A file owner has WRITE_DAC implicitly, but setting its label also needs
  // WRITE_OWNER. Acquire that right temporarily and restore the original DACL.
  // Append the missing allow after existing rules, preserving all deny ACEs.
  // SetEntriesInAclW(GRANT_ACCESS) can replace a deny for the same trustee.
  const DWORD temporary_size = (dacl == nullptr ? sizeof(ACL) : dacl->AclSize) +
      sizeof(ACCESS_ALLOWED_ACE) + GetLengthSid(user);
  std::vector<BYTE> temporary_buffer(temporary_size);
  PACL temporary = reinterpret_cast<PACL>(temporary_buffer.data());
  if (!InitializeAcl(temporary, temporary_size, ACL_REVISION)) return Report(L"Initialize label access", path, GetLastError());
  if (dacl != nullptr) {
    for (DWORD index = 0; index < dacl->AceCount; ++index) {
      void* raw = nullptr;
      if (!GetAce(dacl, index, &raw) ||
          !AddAce(temporary, ACL_REVISION, MAXDWORD, raw, static_cast<ACE_HEADER*>(raw)->AceSize)) {
        return Report(L"Preserve executable access", path, GetLastError());
      }
    }
  }
  if (!AddAccessAllowedAceEx(temporary, ACL_REVISION, 0, WRITE_OWNER, user)) return Report(L"Prepare label access", path, GetLastError());
  result = SetSecurityInfo(file.get(), SE_FILE_OBJECT, DACL_SECURITY_INFORMATION, nullptr, nullptr, temporary, nullptr);
  if (result != ERROR_SUCCESS) return Report(L"Acquire label access", path, result);
  {
    Handle label_file(CreateFileW(path.c_str(), WRITE_OWNER | READ_CONTROL,
        FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, nullptr,
        OPEN_EXISTING, FILE_FLAG_OPEN_REPARSE_POINT, nullptr));
    if (label_file.get() == INVALID_HANDLE_VALUE) result = GetLastError();
    else {
      BY_HANDLE_FILE_INFORMATION before{}, after{};
      if (!GetFileInformationByHandle(file.get(), &before) || !GetFileInformationByHandle(label_file.get(), &after)) {
        result = GetLastError();
      } else if (before.dwVolumeSerialNumber != after.dwVolumeSerialNumber ||
          before.nFileIndexHigh != after.nFileIndexHigh || before.nFileIndexLow != after.nFileIndexLow) {
        result = ERROR_FILE_INVALID;
      } else {
        result = SetSecurityInfo(label_file.get(), SE_FILE_OBJECT, LABEL_SECURITY_INFORMATION,
            nullptr, nullptr, nullptr, medium);
      }
    }
  }
  const DWORD restored = SetSecurityInfo(file.get(), SE_FILE_OBJECT,
      DACL_SECURITY_INFORMATION, nullptr, nullptr, dacl, nullptr);
  if (restored != ERROR_SUCCESS) return Report(L"Restore executable access", path, restored);
  if (result != ERROR_SUCCESS) return Report(L"Set executable integrity", path, result);
  wprintf(L"Restored normal startup integrity: %ls\n", path.c_str());
  return ERROR_SUCCESS;
}
}

int wmain(int argc, wchar_t** argv) {
  if (argc != 3 || wcscmp(argv[1], L"--repair") != 0) return ERROR_BAD_ARGUMENTS;
  const std::wstring root(argv[2]);
  if (root.size() < 3 || root.back() == L'\\' || root.back() == L'/') return ERROR_BAD_PATHNAME;
  const bool drive_rooted = root.size() >= 3 && root[1] == L':' && root[2] == L'\\';
  const bool unc_rooted = root.size() >= 5 && root[0] == L'\\' && root[1] == L'\\';
  if (!drive_rooted && !unc_rooted) return ERROR_BAD_PATHNAME;
  HANDLE raw_token = nullptr;
  if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &raw_token)) return static_cast<int>(GetLastError());
  Handle token_handle(raw_token);
  DWORD size = 0;
  GetTokenInformation(raw_token, TokenUser, nullptr, 0, &size);
  if (size == 0) return static_cast<int>(GetLastError());
  std::vector<BYTE> buffer(size);
  if (!GetTokenInformation(raw_token, TokenUser, buffer.data(), size, &size)) return static_cast<int>(GetLastError());
  PSID user = reinterpret_cast<TOKEN_USER*>(buffer.data())->User.Sid;
  const std::wstring resources = root + L"\\resources";
  const DWORD resource_attributes = GetFileAttributesW(resources.c_str());
  if (resource_attributes != INVALID_FILE_ATTRIBUTES && (resource_attributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0) {
    return static_cast<int>(Report(L"Reject linked resources", resources, ERROR_REPARSE_TAG_INVALID));
  }
  // These are executable images shipped by the locked Windows runtime. DLL
  // integrity also affects sandboxed GPU/renderer initialization.
  for (const auto* name : {L"ElecKoi.exe", L"Uninstall ElecKoi.exe", L"resources\\elevate.exe",
      L"d3dcompiler_47.dll", L"dxcompiler.dll", L"dxil.dll", L"ffmpeg.dll",
      L"vk_swiftshader.dll", L"vulkan-1.dll"}) {
    const std::wstring path = root + L"\\" + name;
    if ((wcscmp(name, L"Uninstall ElecKoi.exe") == 0 || wcscmp(name, L"resources\\elevate.exe") == 0) &&
        GetFileAttributesW(path.c_str()) == INVALID_FILE_ATTRIBUTES &&
        (GetLastError() == ERROR_FILE_NOT_FOUND || GetLastError() == ERROR_PATH_NOT_FOUND)) continue;
    const DWORD result = RepairExecutable(path, user);
    if (result != ERROR_SUCCESS) return static_cast<int>(result);
  }
  return 0;
}
