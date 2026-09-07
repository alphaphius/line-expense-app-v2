(function () {
  'use strict';

  let promptPromise = null;

  function isAuthError(error) {
    return !!error && ['PROTECTED_AUTH_REQUIRED', 'PROTECTED_AUTH_EXPIRED'].includes(error.code);
  }

  async function askForPassword() {
    const result = await Swal.fire({
      title: 'เข้าสู่ส่วนงานภายใน',
      html: '<div class="protected-login"><label for="protected-password-input">รหัสผ่าน</label><div class="protected-password-field"><input id="protected-password-input" type="password" autocomplete="current-password" maxlength="128" aria-describedby="protected-password-help"><button id="protected-password-toggle" type="button" aria-label="แสดงรหัสผ่าน">แสดง</button></div><p id="protected-password-help">ใช้สำหรับเอกสารใบรับเงิน สรุปค่าแรง Task Manager และฐานข้อมูล</p><p class="protected-login__open-note">ส่วนค่าใช้จ่ายและบิลเข้าใช้งานได้โดยไม่ต้องใส่รหัส</p></div>',
      showCancelButton: true,
      confirmButtonText: 'เข้าสู่ระบบ',
      cancelButtonText: 'ยกเลิก',
      confirmButtonColor: '#8f5f42',
      focusConfirm: false,
      didOpen(popup) {
        const input = popup.querySelector('#protected-password-input');
        const toggle = popup.querySelector('#protected-password-toggle');
        toggle.addEventListener('click', () => {
          const reveal = input.type === 'password';
          input.type = reveal ? 'text' : 'password';
          toggle.textContent = reveal ? 'ซ่อน' : 'แสดง';
          toggle.setAttribute('aria-label', reveal ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน');
          input.focus();
        });
        input.focus();
      },
      preConfirm: async () => {
        const password = document.getElementById('protected-password-input').value;
        if (!password) {
          Swal.showValidationMessage('กรุณากรอกรหัสผ่าน');
          return false;
        }
        try {
          await window.V2Api.unlockProtected(password);
          return true;
        } catch (error) {
          Swal.showValidationMessage(error.message || 'รหัสผ่านไม่ถูกต้อง');
          return false;
        }
      },
    });
    return !!result.isConfirmed;
  }

  async function ensure() {
    if (window.V2Api.hasProtectedSession()) return true;
    if (!promptPromise) promptPromise = askForPassword().finally(() => { promptPromise = null; });
    return promptPromise;
  }

  window.ProtectedAccess = Object.freeze({ ensure, isAuthError });
})();
