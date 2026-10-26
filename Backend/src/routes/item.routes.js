const express = require('express');
const router = express.Router();
const itemController = require('../controllers/item.controller');
const auth = require('../middleware/auth');
const workspaceRole = require('../middleware/workspaceRole');

router.use(auth);

router.get('/', workspaceRole('OWNER', 'ADMIN', 'MEMBER', 'VIEWER'), itemController.listItems);
router.get('/:id', workspaceRole('OWNER', 'ADMIN', 'MEMBER', 'VIEWER'), itemController.getItem);
router.post('/', workspaceRole('OWNER', 'ADMIN', 'MEMBER'), itemController.createItem);
router.put('/:id', workspaceRole('OWNER', 'ADMIN', 'MEMBER'), itemController.updateItem);
router.delete('/:id', workspaceRole('OWNER', 'ADMIN'), itemController.deleteItem);

module.exports = router;
