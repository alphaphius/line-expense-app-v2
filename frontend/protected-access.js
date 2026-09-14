(function () {
  'use strict';

  let promptPromise = null;

  function isAuthError(error) {
    return !!error && ['PROTECTED_AUTH_REQUIRED', 'PROTECTED_AUTH_EXPIRED'].includes(error.code);
  }

  async function askForPassword(options = {}) {
    const destructive = options.mode === 'delete';
    const result = await Swal.fire({
      icon: destructive ? 'warning' : undefined,
      title: destructive ? (options.title || 'ยืนยันการลบข้อมูล') : 'เข้าสู่ส่วนงานภายใน',
      html: `<div class="protected-login">${destructive ? `<p id="protected-password-help">${options.message || 'รายการนี้จะถูกลบออกจากเครื่องและไม่สามารถย้อนกลับได้'}</p>` : ''}<label for="protected-password-input">รหัสผ่าน</label><div class="protected-password-field"><input id="protected-password-input" type="password" autocomplete="current-password" maxlength="128" aria-describedby="protected-password-help"><button id="protected-password-toggle" type="button" aria-label="แสดงรหัสผ่าน">แสดง</button></div>${destructive ? '<p class="protected-login__open-note">กรอกรหัสเดียวกับที่ใช้เข้าส่วนงานภายในเพื่อยืนยัน</p>' : '<p id="protected-password-help">ใช้สำหรับเอกสาร ค่าแรง Task Manager รายงาน และระบบภายใน</p><p class="protected-login__open-note">ส่วนค่าใช้จ่ายและบิลเข้าใช้งานได้โดยไม่ต้องใส่รหัส</p>'}</div>`,
      showCancelButton: true,
      confirmButtonText: destructive ? 'ยืนยันลบ' : 'เข้าสู่ระบบ',
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

  async function reauthenticate(options = {}) {
    return askForPassword({ ...options, mode: 'delete' });
  }

  window.ProtectedAccess = Object.freeze({ ensure, reauthenticate, isAuthError });
})();
