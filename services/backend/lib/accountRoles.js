const ACCOUNT_ROLE = Object.freeze({
  CLIENT: 'client',
  STAFF: 'staff',
});

function getAccountRole(user) {
  if (user?.app_metadata?.role === ACCOUNT_ROLE.CLIENT) return ACCOUNT_ROLE.CLIENT;
  if (user?.app_metadata?.role === ACCOUNT_ROLE.STAFF) return ACCOUNT_ROLE.STAFF;

  // Backward compatibility for accounts created before explicit roles.
  if (user?.app_metadata?.taxflow_client_portal === true) return ACCOUNT_ROLE.CLIENT;
  return ACCOUNT_ROLE.STAFF;
}

function isClientAccount(user) {
  return getAccountRole(user) === ACCOUNT_ROLE.CLIENT;
}

module.exports = { ACCOUNT_ROLE, getAccountRole, isClientAccount };
