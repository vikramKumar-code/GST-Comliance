import client from './client';

export const listItems = (params = {}) => client.get('/items', { params });
export const getItem = (id) => client.get(`/items/${id}`);
export const createItem = (data) => client.post('/items', data);
export const updateItem = (id, data) => client.put(`/items/${id}`, data);
export const deleteItem = (id) => client.delete(`/items/${id}`);
