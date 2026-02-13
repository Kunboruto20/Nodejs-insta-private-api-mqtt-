const Repository = require('../core/repository');

class NoteRepository extends Repository {
  async getNotes() {
    const response = await this.client.request.send({
      method: 'GET',
      url: '/api/v1/notes/get_notes/',
    });
    return response.body;
  }

  async createNote(text, audience = 0) {
    const response = await this.client.request.send({
      method: 'POST',
      url: '/api/v1/notes/create_note/',
      form: this.client.request.sign({
        _uuid: this.client.state.uuid,
        text,
        audience,
      }),
    });
    return response.body;
  }

  async deleteNote(noteId) {
    const response = await this.client.request.send({
      method: 'POST',
      url: `/api/v1/notes/delete_note/${noteId}/`,
      form: this.client.request.sign({
        _uuid: this.client.state.uuid,
        id: noteId,
      }),
    });
    return response.body;
  }

  async lastSeenUpdateNote() {
    const response = await this.client.request.send({
      method: 'POST',
      url: '/api/v1/notes/last_seen_update/',
      form: this.client.request.sign({
        _uuid: this.client.state.uuid,
      }),
    });
    return response.body;
  }

  async getNotesFollowing() {
    const response = await this.client.request.send({
      method: 'GET',
      url: '/api/v1/notes/following_notes/',
    });
    return response.body;
  }
}

module.exports = NoteRepository;
